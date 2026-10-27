import { describe, expect, it } from 'vitest'
import { processEvent, type ProcessEventContext } from './process-event'
import { createEmptyState } from './types'

const context: ProcessEventContext = {
  skipForceSync: true,
  blockIdCounter: { current: 0 },
  syncForceSimulation() {},
  findToolSlot: () => ({ x: 0, y: 0 }),
  getContextWindowSize: () => 200000,
}

describe('provider identity in agent graphs', () => {
  it.each([
    ['claude', 'codex', 'gpt-6.1-sol'],
    ['codex', 'claude', 'sonnet'],
  ])('keeps a %s parent distinct from its %s reviewer', (parentProvider, childProvider, model) => {
    let state = processEvent({ time: 0, type: 'agent_spawn', payload: { name: 'orchestrator', isMain: true, provider: parentProvider } }, createEmptyState(), context)
    state = processEvent({ time: 1, type: 'agent_spawn', payload: { name: 'reviewer', parent: 'orchestrator', model } }, state, context)
    expect(state.agents.get('orchestrator')?.provider).toBe(parentProvider)
    expect(state.agents.get('reviewer')?.provider).toBe(childProvider)
  })

  it('inherits the provider for native children and applies later metadata only to the addressed child', () => {
    let state = processEvent({ time: 0, type: 'agent_spawn', payload: { name: 'orchestrator', isMain: true, provider: 'codex' } }, createEmptyState(), context)
    state = processEvent({ time: 1, type: 'agent_spawn', payload: { name: 'child', parent: 'orchestrator' } }, state, context)
    expect(state.agents.get('child')?.provider).toBe('codex')
    state = processEvent({ time: 2, type: 'model_detected', payload: { agent: 'child', provider: 'claude' } }, state, context)
    expect(state.agents.get('child')?.provider).toBe('claude')
    expect(state.agents.get('child')?.tokensMax).toBe(200000)
    expect(state.agents.get('orchestrator')?.provider).toBe('codex')
  })

  it('keeps one linked reviewer and its history when its native transcript confirms the spawn', () => {
    let state = processEvent({ time: 0, type: 'agent_spawn', payload: { name: 'orchestrator', isMain: true, provider: 'claude' } }, createEmptyState(), context)
    const reviewer = { time: 1, type: 'agent_spawn' as const, payload: { name: 'Sol review', parent: 'orchestrator', provider: 'codex' } }
    state = processEvent(reviewer, state, context)
    state = processEvent({ time: 2, type: 'message', payload: { agent: 'Sol review', role: 'assistant', content: 'Reviewing the diff' } }, state, context)
    const history = state.conversations.get('Sol review')
    state = processEvent(reviewer, state, context)
    expect(state.agents.size).toBe(2)
    expect(state.edges.filter(edge => edge.type === 'parent-child')).toHaveLength(1)
    expect(state.conversations.get('Sol review')).toBe(history)
    expect(state.agents.get('Sol review')?.messageBubbles).toHaveLength(1)
    state = processEvent({ time: 3, type: 'agent_complete', payload: { name: 'Sol review' } }, state, context)
    state = processEvent(reviewer, state, context)
    expect(state.agents.get('Sol review')?.state).toBe('complete')
    state = processEvent({ ...reviewer, payload: { ...reviewer.payload, resumed: true } }, state, context)
    expect(state.agents.get('Sol review')?.state).toBe('idle')
    expect(state.conversations.get('Sol review')).toBe(history)
  })

  it('does not reactivate an idle or completed agent when delayed token or idle events arrive', () => {
    let state = processEvent({ time: 0, type: 'agent_spawn', payload: { name: 'orchestrator', isMain: true, provider: 'codex' } }, createEmptyState(), context)
    state = processEvent({ time: 1, type: 'agent_idle', payload: { name: 'orchestrator', turnComplete: true } }, state, context)
    state = processEvent({ time: 2, type: 'context_update', payload: { agent: 'orchestrator', tokens: 68000 } }, state, context)
    expect(state.agents.get('orchestrator')?.state).toBe('idle')
    state = processEvent({ time: 3, type: 'agent_complete', payload: { name: 'orchestrator' } }, state, context)
    state = processEvent({ time: 4, type: 'agent_idle', payload: { name: 'orchestrator', turnComplete: true } }, state, context)
    state = processEvent({ time: 5, type: 'context_update', payload: { agent: 'orchestrator', tokens: 69000 } }, state, context)
    expect(state.agents.get('orchestrator')?.state).toBe('complete')
    expect(state.agents.get('orchestrator')?.tokensUsed).toBe(69000)
  })
})
