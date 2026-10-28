import { describe, expect, it } from 'vitest'
import { DelegatedSessionRouter } from './delegated-session-router'
import type { AgentEvent, SessionInfo } from './protocol'

function setup() {
  const threads = new Map<string, string>()
  const sessions = new Map<string, SessionInfo>([
    ['claude-parent', { id: 'claude-parent', label: 'Parent', status: 'active', startTime: 1000, lastActivityTime: 2000 }],
    ['codex:review', { id: 'codex:review', label: 'Sol review', status: 'active', startTime: 11000, lastActivityTime: 12000 }],
  ])
  return { threads, router: new DelegatedSessionRouter(id => threads.get(id), id => sessions.get(id)) }
}

const link: AgentEvent = { sessionId: 'claude-parent', time: 10, type: 'agent_link', payload: { name: 'Sol review · call-id', parent: 'orchestrator', childThreadId: 't3-child' } }

describe('delegated session routing', () => {
  it('resolves a late native session ID and routes tools, model, tokens and completion to the linked reviewer', () => {
    const { threads, router } = setup()
    router.observe(link)
    expect(router.refresh()).toEqual([])
    threads.set('t3-child', 'codex:review')
    expect(router.refresh()).toEqual([expect.objectContaining({ sessionId: 'codex:review', parentSessionId: 'claude-parent', agentName: 'Sol review · call-id' })])
    expect(router.refresh()).toEqual([])
    for (const type of ['message', 'tool_call_start', 'tool_call_end', 'model_detected', 'context_update'] as const) {
      expect(router.route({ type, sessionId: 'codex:review', time: 2, payload: { agent: 'orchestrator', content: 'Reviewing', tokens: 68000 } })).toMatchObject({
        sessionId: 'claude-parent', time: 12, type, payload: { agent: 'Sol review · call-id', content: 'Reviewing', tokens: 68000 },
      })
    }
    expect(router.route({ type: 'agent_spawn', sessionId: 'codex:review', time: 0, payload: { name: 'orchestrator', isMain: true, provider: 'codex' } })).toMatchObject({
      sessionId: 'claude-parent', payload: { name: 'Sol review · call-id', parent: 'orchestrator', isMain: false, provider: 'codex' },
    })
    expect(router.route({ type: 'agent_idle', sessionId: 'codex:review', time: 60, payload: { name: 'orchestrator', turnComplete: true } })).toMatchObject({
      type: 'agent_complete', sessionId: 'claude-parent', payload: { name: 'Sol review · call-id' },
    })
    expect(router.route(link)).toBeNull()
  })

  it('recovers the binding from replay and never matches sessions by a shared title', () => {
    const { threads, router } = setup()
    threads.set('t3-child', 'codex:review')
    router.observe({ ...link, type: 'agent_spawn' })
    router.refresh()
    const independent: AgentEvent = { type: 'message', sessionId: 'codex:another-review', time: 1, payload: { agent: 'orchestrator', content: 'Sol review' } }
    expect(router.route(independent)).toBe(independent)
    expect(router.isLinked('codex:review')).toBe(true)
    expect(router.depth('codex:review')).toBe(1)
  })

  it('keeps nested agents distinct and rejects cyclic or self links', () => {
    const { router } = setup()
    router.observe({ ...link, payload: { ...link.payload, childSessionId: 'codex:review' } })
    router.refresh()
    router.observe({ type: 'agent_link', time: 0, sessionId: 'codex:review', payload: { name: 'Jury', childSessionId: 'claude-jury' } })
    router.refresh()
    const routed = router.route({ type: 'agent_spawn', time: 0, sessionId: 'claude-jury', payload: { name: 'orchestrator', isMain: true, provider: 'claude' } })
    expect(routed).toMatchObject({ sessionId: 'claude-parent', payload: { name: '["codex:review","Jury"]', parent: 'Sol review · call-id', isMain: false } })
    expect(router.root('claude-jury')).toBe('claude-parent')
    router.observe({ type: 'agent_link', time: 0, sessionId: 'claude-jury', payload: { name: 'Cycle', childSessionId: 'claude-parent' } })
    router.observe({ type: 'agent_link', time: 0, sessionId: 'claude-jury', payload: { name: 'Self', childSessionId: 'claude-jury' } })
    expect(router.refresh()).toEqual([])
  })
})
