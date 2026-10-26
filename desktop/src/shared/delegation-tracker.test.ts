import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DelegationTracker } from './delegation-tracker'
import { CodexTranscriptParser } from './codex-transcript-parser'
import { TranscriptParser } from './transcript-parser'
import type { AgentEvent, WatchedSession } from './protocol'
import { SessionWatcher } from './session-watcher'

function tracker(provider: 'claude' | 'codex' = 'claude') {
  const events: AgentEvent[] = []
  return { events, tracker: new DelegationTracker({ emit: event => events.push(event), elapsed: () => 1 }, provider) }
}

describe('cross-provider delegations', () => {
  it('represents Sol delegated by Claude and keeps an async reviewer active after dispatch returns', () => {
    const { tracker: subject, events } = tracker()
    subject.start('call-sol', 'mcp__t3-code__delegate_task', {
      title: 'Sol review', task: 'Review the changes', target: { providerInstanceId: 'codex', model: 'gpt-6.1-sol' },
    }, 'orchestrator')
    subject.result('call-sol', JSON.stringify({ taskId: 'task-sol', status: 'running', providerInstanceId: 'codex', model: 'gpt-6.1-sol' }))
    expect(events.find(event => event.type === 'agent_spawn')?.payload).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol', parent: 'orchestrator' })
    expect(events.some(event => event.type === 'agent_complete')).toBe(false)
    subject.result('status-call', { taskId: 'task-sol', status: 'completed' })
    expect(events.filter(event => event.type === 'agent_complete')).toHaveLength(1)
    expect(subject.replayEvents().find(event => event.type === 'agent_spawn')?.payload.provider).toBe('codex')
  })

  it('represents a council GPT reviewer even when Codex runs without a persisted session', () => {
    const { tracker: subject, events } = tracker()
    subject.start('call-cli', 'Bash', {
      command: 'codex exec --ignore-user-config -m gpt-6.1-sol \\\n  --ephemeral - < /tmp/council/prompt.md > /tmp/council/read.log 2>&1',
      description: 'Council GPT reader', run_in_background: true,
    }, 'orchestrator')
    subject.result('call-cli', 'Command running in background with ID: background-1')
    expect(events.find(event => event.type === 'agent_spawn')?.payload).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol' })
    expect(events.some(event => event.type === 'agent_complete')).toBe(false)
    subject.observeText('<task-notification><task-id>background-1</task-id><status>completed</status></task-notification>')
    expect(events.filter(event => event.type === 'agent_complete')).toHaveLength(1)
  })

  it('does not mistake commands mentioned in prompts, searches, or heredocs for executions', () => {
    const { tracker: subject, events } = tracker()
    for (const [index, command] of [
      'echo "codex exec -m gpt-6.1-sol --ephemeral"',
      'rg "codex exec" README.md',
      "cat <<'EOF'\ncodex exec --ephemeral\nEOF",
    ].entries()) subject.start(String(index), 'Bash', { command }, 'orchestrator')
    expect(events).toHaveLength(0)
  })

  it('takes the executed provider from the result and preserves same-title reviewers as distinct nodes', () => {
    const { tracker: subject, events } = tracker('codex')
    subject.start('call-1', 'delegate_task', { title: 'Reader' }, 'orchestrator')
    subject.start('call-2', 'delegate_task', { title: 'Reader' }, 'orchestrator')
    subject.result('call-1', { content: [{ type: 'text', text: JSON.stringify({ taskId: 'claude-child', providerInstanceId: 'claudeAgent', model: 'claude-sonnet-4', status: 'running' }) }] })
    expect(new Set(events.filter(event => event.type === 'agent_spawn').map(event => event.payload.name)).size).toBe(2)
    expect(subject.replayEvents().find(event => event.type === 'agent_spawn')?.payload).toMatchObject({ provider: 'claude', model: 'claude-sonnet-4' })
  })
})

describe('provider information from transcripts', () => {
  it('reads Claude reviewers launched by Codex through T3 code-mode tool records', () => {
    const events: AgentEvent[] = []
    const parser = new CodexTranscriptParser({ emit: event => events.push(event), elapsed: () => 1, onLabel() {}, onTurnState() {} })
    const item = { type: 'McpToolCall', id: 'council-c1', tool: 'delegate_task', server: 't3-code', arguments: {
      title: 'Council C1', target: { providerInstanceId: 'claudeAgent', model: 'claude-opus-4' },
    }, result: { structuredContent: { taskId: 'c1', status: 'running' } } }
    parser.processLine(JSON.stringify({ type: 'event_msg', payload: { type: 'item_started', item } }))
    parser.processLine(JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item } }))
    expect(events.filter(event => event.type === 'agent_spawn')).toHaveLength(1)
    expect(events.find(event => event.type === 'agent_spawn')?.payload).toMatchObject({ parent: 'orchestrator', provider: 'claude', model: 'claude-opus-4' })
    expect(events.some(event => event.type === 'agent_complete')).toBe(false)
  })

  it('reads native Codex subagents with the model requested for each reviewer', () => {
    const events: AgentEvent[] = []
    const parser = new CodexTranscriptParser({ emit: event => events.push(event), elapsed: () => 1, onLabel() {}, onTurnState() {} })
    parser.processLine(JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'native-1', arguments: JSON.stringify({ task_name: 'Reviewer', model: 'gpt-6.1-sol' }) } }))
    expect(events.find(event => event.type === 'agent_spawn')?.payload).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol' })
  })

  it('represents a direct CLI reviewer once when Codex also records the command execution', () => {
    const events: AgentEvent[] = []
    const parser = new CodexTranscriptParser({ emit: event => events.push(event), elapsed: () => 1, onLabel() {}, onTurnState() {} })
    const command = 'claude --model sonnet --print "Review the diff"'
    parser.processLine(JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call-cli', arguments: JSON.stringify({ cmd: command }) } }))
    parser.processLine(JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', id: 'exec-cli', command: ['/bin/zsh', '-lc', command], status: 'completed' } } }))
    parser.processLine(JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-cli', output: 'Done' } }))
    expect(events.filter(event => event.type === 'agent_spawn')).toHaveLength(1)
    expect(events.find(event => event.type === 'agent_spawn')?.payload).toMatchObject({ provider: 'claude', model: 'sonnet' })
    expect(events.filter(event => event.type === 'agent_complete')).toHaveLength(1)
  })

  it('recovers a cross-provider delegation that predates detection and window reopening', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-mixed-'))
    const watcher = new SessionWatcher({ claudeDir: root, enableGlobalRootWatch: false })
    try {
      fs.mkdirSync(path.join(root, 'project'))
      const entries = [
        { type: 'assistant', sessionId: 'mixed', message: { role: 'assistant', model: 'claude-opus-4', content: [
          { type: 'tool_use', id: 'sol-call', name: 'mcp__t3-code__delegate_task', input: { title: 'Sol review', target: { providerInstanceId: 'codex', model: 'gpt-6.1-sol' } } },
        ] } },
        { type: 'user', sessionId: 'mixed', message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'sol-call', content: JSON.stringify({ taskId: 'task-sol', status: 'running' }) },
        ] } },
      ]
      fs.writeFileSync(path.join(root, 'project', 'mixed.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
      watcher.forceScan()
      const replay = watcher.buildReplayStartEvents().map(value => value.event)
      expect(replay.find(event => event.type === 'agent_spawn' && event.payload.isMain)?.payload.provider).toBe('claude')
      expect(replay.find(event => event.type === 'agent_spawn' && event.payload.parent)?.payload).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol' })
      expect(replay.some(event => event.type === 'agent_complete')).toBe(false)
    } finally {
      watcher.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps Dredd child model detection independent of the Claude orchestrator model', () => {
    const events: AgentEvent[] = []
    const session = { model: 'claude-opus-4', spawnedSubagents: new Set() } as WatchedSession
    const parser = new TranscriptParser({ emit: event => events.push(event), elapsed: () => 1, getSession: () => session, fireSessionLifecycle() {}, emitContextUpdate() {} })
    parser.handleToolUse({ type: 'tool_use', id: 'dredd', name: 'Agent', input: { name: 'Dredd jury', model: 'sonnet', prompt: 'Review only' } }, 'orchestrator', new Map(), 'session')
    expect(events.find(event => event.type === 'agent_spawn')?.payload).toMatchObject({ provider: 'claude', model: 'sonnet' })
    parser.processTranscriptLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4', content: [] } }), 'Dredd jury', new Map(), new Set(), 'session')
    expect(events.find(event => event.type === 'model_detected')?.payload).toMatchObject({ agent: 'Dredd jury', model: 'claude-sonnet-4', provider: 'claude' })
    expect(session.model).toBe('claude-opus-4')
  })
})
