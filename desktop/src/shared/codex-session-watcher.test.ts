import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexSessionWatcher } from './codex-session-watcher'
import type { AgentEvent } from './protocol'
import type { SessionLifecycle } from './session-source'
import { ACTIVE_SESSION_AGE_S, INACTIVITY_TIMEOUT_MS, ORCHESTRATOR_NAME } from './constants'

const line = (type: string, payload: Record<string, unknown>) => JSON.stringify({ type, payload }) + '\n'
const message = (role: string, text: string, id: string) => line('response_item', {
  type: 'message', role, id, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
})

describe('CodexSessionWatcher', () => {
  let root: string
  let watcher: CodexSessionWatcher
  let events: AgentEvent[]
  let lifecycle: SessionLifecycle[]

  beforeEach(() => {
    vi.useFakeTimers()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-codex-'))
    watcher = new CodexSessionWatcher({ sessionsDir: path.join(root, 'sessions'), t3DataDir: path.join(root, 't3') })
    events = []
    lifecycle = []
    watcher.onEvent(event => events.push(event))
    watcher.onSessionLifecycle(event => lifecycle.push(event))
  })

  afterEach(() => {
    watcher.dispose()
    fs.rmSync(root, { recursive: true, force: true })
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  function rollout(id: string, content = '', day = '2026/10/26'): string {
    const directory = path.join(root, 'sessions', day)
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, `rollout-${id}.jsonl`)
    fs.writeFileSync(file, line('session_meta', { id, timestamp: new Date().toISOString(), cwd: '/projects/my-app', source: 'vscode', originator: 'T3 Code' }) + content)
    return file
  }

  it('discovers Codex sessions and replays canonical messages, tools, model and usage after window reopen', () => {
    rollout('s1',
      line('event_msg', { type: 'task_started' }) +
      message('user', '<environment_context>injected context</environment_context>', 'context') +
      message('user', 'Fix navbar', 'user-1') +
      line('event_msg', { type: 'user_message', message: 'Fix navbar' }) +
      line('turn_context', { model: 'gpt-5.3-codex' }) +
      line('response_item', { type: 'function_call', name: 'exec_command', call_id: 'call-1', arguments: JSON.stringify({ cmd: 'npm test' }) }) +
      line('response_item', { type: 'function_call_output', call_id: 'call-1', output: 'All tests passed' }) +
      line('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-2', input: '*** Begin Patch' }) +
      line('response_item', { type: 'custom_tool_call_output', call_id: 'call-2', output: 'Done' }) +
      message('assistant', 'Fixed the navbar', 'assistant-1') +
      line('event_msg', { type: 'agent_message', message: 'Fixed the navbar' }) +
      line('event_msg', { type: 'token_count', info: { last_token_usage: { total_tokens: 1500 }, total_token_usage: { total_tokens: 9000 } } }) +
      line('event_msg', { type: 'task_complete' }),
    )
    watcher.start()

    expect(watcher.getActiveSessions()).toEqual([expect.objectContaining({ id: 'codex:s1', provider: 'codex', label: 'Fix navbar', status: 'completed' })])
    expect(events[0].type).toBe('agent_spawn')
    expect(events.every(event => event.sessionId === 'codex:s1')).toBe(true)
    expect(events.filter(event => event.type === 'message').map(event => event.payload.content)).toEqual(['Fix navbar', 'Fixed the navbar'])
    expect(events.filter(event => event.type === 'tool_call_start').map(event => event.payload.tool)).toEqual(['exec_command', 'apply_patch'])
    expect(events.filter(event => event.type === 'tool_call_end')).toHaveLength(2)
    expect(events).toContainEqual(expect.objectContaining({ type: 'context_update', payload: { agent: ORCHESTRATOR_NAME, tokens: 1500 } }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'model_detected', payload: { agent: ORCHESTRATOR_NAME, model: 'gpt-5.3-codex' } }))
    expect(lifecycle.map(event => event.type)).toEqual(['started', 'ended'])
    expect(watcher.buildReplayStartEvents().map(replay => replay.event.type)).toEqual(events.map(event => event.type))
    expect(watcher.buildReplayStartEvents(['another-session'])).toEqual([])
    const count = events.length
    watcher.forceScan()
    expect(events).toHaveLength(count)
  })

  it('discovers a sessions directory created after startup and waits for complete UTF-8 records', () => {
    watcher.start()
    const file = rollout('late')
    watcher.forceScan()
    const nextMessage = Buffer.from(message('user', 'Arreglar 🚀', 'user-1'))
    const splitAt = nextMessage.indexOf(Buffer.from('🚀')) + 2
    fs.appendFileSync(file, nextMessage.subarray(0, splitAt))
    watcher.forceScan()
    expect(events.filter(event => event.type === 'message')).toHaveLength(0)
    fs.appendFileSync(file, nextMessage.subarray(splitAt))
    watcher.forceScan()
    expect(events.filter(event => event.type === 'message').map(event => event.payload.content)).toEqual(['Arreglar 🚀'])
    expect(watcher.getActiveSessions()[0].label).toBe('Arreglar 🚀')
    expect(lifecycle).toContainEqual({ type: 'updated', sessionId: 'codex:late', label: 'Arreglar 🚀' })
  })

  it('restores old messages without showing them as live bubbles, while new messages remain live', () => {
    const file = rollout('history', message('user', 'Old request', 'user-1') + message('assistant', 'Old answer', 'assistant-1'))
    watcher.start()
    expect(events.filter(event => event.type === 'message')).toHaveLength(2)
    expect(events.filter(event => event.type === 'message').every(event => event.payload.historical === true)).toBe(true)

    fs.appendFileSync(file, message('user', 'New request', 'user-2'))
    watcher.forceScan()
    expect(events.at(-1)?.payload).toMatchObject({ content: 'New request' })
    expect(events.at(-1)?.payload.historical).toBeUndefined()
  })

  it('prefers saved session names over the initial prompt and detects a rename without new transcript content', () => {
    const index = path.join(root, 'session_index.jsonl')
    fs.writeFileSync(index, JSON.stringify({ id: 'named', thread_name: 'Horizontal nodes' }) + '\n')
    rollout('named', message('user', 'A long initial prompt that is not the session name', 'user-1'))
    watcher.start()
    expect(watcher.getActiveSessions()[0].label).toBe('Horizontal nodes')
    expect(events[0].payload.task).toBe('Horizontal nodes')

    fs.appendFileSync(index, JSON.stringify({ id: 'named', thread_name: 'Renamed graph' }) + '\n')
    watcher.forceScan()
    expect(watcher.getActiveSessions()[0].label).toBe('Renamed graph')
    expect(lifecycle.at(-1)).toEqual({ type: 'updated', sessionId: 'codex:named', label: 'Renamed graph' })
    expect(watcher.buildReplayStartEvents()[0].event.payload.task).toBe('Renamed graph')
  })

  it('ignores stale history but detects sessions resumed in old date directories', () => {
    const old = rollout('old', '', '2025/01/01')
    const staleTime = new Date(Date.now() - (ACTIVE_SESSION_AGE_S + 60) * 1000)
    fs.utimesSync(old, staleTime, staleTime)
    rollout('new')
    watcher.start()
    expect(watcher.getActiveSessions().map(session => session.id)).toEqual(['codex:new'])
    fs.appendFileSync(old, message('user', 'Resume work', 'resumed'))
    watcher.forceScan()
    expect(watcher.getActiveSessions().map(session => session.id)).toContain('codex:old')
  })

  it.each(['task_complete', 'turn_complete', 'turn_aborted', undefined])('expires an inactive node after %s, including its replay history', (completion) => {
    rollout('inactive', message('user', 'First task', 'user-1') + (completion ? line('event_msg', { type: completion }) : ''))
    watcher.start()
    const expiresAt = Math.ceil(watcher.getActiveSessions()[0].lastActivityTime) + INACTIVITY_TIMEOUT_MS

    vi.setSystemTime(expiresAt - 1)
    watcher.forceScan()
    expect(events.filter(event => event.type === 'agent_complete')).toHaveLength(0)

    vi.setSystemTime(expiresAt)
    watcher.forceScan()
    expect(events.filter(event => event.type === 'agent_complete')).toEqual([
      expect.objectContaining({ sessionId: 'codex:inactive', payload: { name: ORCHESTRATOR_NAME } }),
    ])
    expect(watcher.getActiveSessions()[0].status).toBe('completed')
    expect(watcher.buildReplayStartEvents().at(-1)?.event.type).toBe('agent_complete')

    watcher.forceScan()
    expect(events.filter(event => event.type === 'agent_complete')).toHaveLength(1)
  })

  it('recreates an expired node before delivering a resumed turn, and can expire it again', () => {
    const file = rollout('resume', message('user', 'First task', 'user-1'))
    watcher.start()
    vi.setSystemTime(watcher.getActiveSessions()[0].lastActivityTime + INACTIVITY_TIMEOUT_MS + 1)
    watcher.forceScan()
    expect(watcher.getActiveSessions()[0].status).toBe('completed')
    fs.appendFileSync(file, line('event_msg', { type: 'task_started' }) + message('user', 'Second task', 'user-2'))
    fs.utimesSync(file, new Date(), new Date())
    watcher.forceScan()
    expect(watcher.getActiveSessions()[0].status).toBe('active')
    expect(lifecycle.map(event => event.type)).toEqual(['started', 'ended', 'started'])
    expect(events.filter(event => event.type === 'agent_spawn')).toHaveLength(2)
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: 'agent_spawn', payload: expect.objectContaining({ name: ORCHESTRATOR_NAME, provider: 'codex' }) }),
      expect.objectContaining({ type: 'message', payload: expect.objectContaining({ content: 'Second task' }) }),
    ])

    vi.setSystemTime(Math.ceil(watcher.getActiveSessions()[0].lastActivityTime) + INACTIVITY_TIMEOUT_MS)
    watcher.forceScan()
    expect(events.filter(event => event.type === 'agent_complete')).toHaveLength(2)
  })

  it('keeps a node and its history when another turn starts before the inactivity timeout', () => {
    const file = rollout('quick-resume', message('user', 'First task', 'user-1') + line('event_msg', { type: 'task_complete' }))
    watcher.start()
    vi.setSystemTime(watcher.getActiveSessions()[0].lastActivityTime + INACTIVITY_TIMEOUT_MS - 1)
    fs.appendFileSync(file, line('event_msg', { type: 'task_started' }) + message('user', 'Second task', 'user-2'))
    fs.utimesSync(file, new Date(), new Date())
    watcher.forceScan()

    expect(watcher.getActiveSessions()[0].status).toBe('active')
    expect(events.filter(event => event.type === 'agent_spawn')).toHaveLength(1)
    expect(events.filter(event => event.type === 'agent_complete')).toHaveLength(0)
    expect(events.filter(event => event.type === 'message').map(event => event.payload.content)).toEqual(['First task', 'Second task'])
  })

  it('uses CODEX_HOME without requiring a Claude directory', () => {
    watcher.dispose()
    vi.stubEnv('CODEX_HOME', root)
    watcher = new CodexSessionWatcher({ t3DataDir: path.join(root, 't3') })
    rollout('custom-home')
    watcher.start()
    expect(watcher.getActiveSessions()[0]).toMatchObject({ id: 'codex:custom-home', provider: 'codex' })
  })
})
