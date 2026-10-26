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
})
