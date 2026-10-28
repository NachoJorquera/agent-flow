import { describe, expect, it } from 'vitest'
import { processEvent, type ProcessEventContext } from './process-event'
import { createEmptyState } from './types'
import { historicalEvent, scopeSessionEvent } from '@/lib/session-events'

const context: ProcessEventContext = {
  skipForceSync: true, blockIdCounter: { current: 0 }, syncForceSimulation() {},
  findToolSlot: () => ({ x: 0, y: 0 }), getContextWindowSize: () => 1000000,
}

describe('historical conversation loading', () => {
  it('retains the conversation without flooding a GPT node with old user, assistant or thinking bubbles', () => {
    let state = processEvent(scopeSessionEvent({ type: 'agent_spawn', time: 0, sessionId: 'codex:session', payload: { name: 'orchestrator', isMain: true, provider: 'codex' } }), createEmptyState(), context)
    const agentId = JSON.stringify(['codex:session', 'orchestrator'])
    for (let i = 0; i < 30; i++) {
      const role = ['user', 'assistant', 'thinking'][i % 3]
      state = processEvent(scopeSessionEvent(historicalEvent({ type: 'message', time: 1, sessionId: 'codex:session', payload: { agent: 'orchestrator', role, content: `Old message ${i}` } })), state, context)
    }
    expect(state.conversations.get(agentId)).toHaveLength(30)
    expect(state.agents.get(agentId)?.messageBubbles).toEqual([])

    state = processEvent(scopeSessionEvent({ type: 'message', time: 2, sessionId: 'codex:session', payload: { agent: 'orchestrator', role: 'assistant', content: 'Current progress' } }), state, context)
    expect(state.conversations.get(agentId)).toHaveLength(31)
    expect(state.agents.get(agentId)?.messageBubbles.map(bubble => bubble.text)).toEqual(['Current progress'])
  })
})
