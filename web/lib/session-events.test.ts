import { describe, expect, it, vi } from 'vitest'
import type { SimulationEvent } from './agent-types'
import { processEvent, type ProcessEventContext } from '@/hooks/simulation/process-event'
import { computeNextFrame } from '@/hooks/simulation/animate'
import { snapVisualState } from '@/hooks/simulation/snap-visual-state'
import { createEmptyState, type SimulationState } from '@/hooks/simulation/types'
import { scopeSessionEvent } from './session-events'

const quietContext = (): ProcessEventContext => ({
  syncForceSimulation: () => {},
  findToolSlot: () => ({ x: 0, y: 0 }),
  getContextWindowSize: () => 200000,
  blockIdCounter: { current: 0 },
  skipForceSync: true,
})

function emitTo(state: SimulationState, sessionId: string, type: SimulationEvent['type'], payload: Record<string, unknown>) {
  return processEvent(scopeSessionEvent({ sessionId, type, payload, time: state.currentTime }), state, quietContext())
}

function advanceSeconds(state: SimulationState, seconds: number) {
  const options = { useMockData: false, mockScenarioLength: 0, mockScenarioEndTime: 0 }
  for (let i = 0; i < seconds; i++) {
    const next = state.currentTime + 1
    state = computeNextFrame(state, 1, next, next, state, options)
  }
  return state
}

describe('combined session events', () => {
  it('keeps agents, tools, permissions and completion isolated across sessions with the same agent names', () => {
    const ctx: ProcessEventContext = {
      syncForceSimulation: vi.fn(),
      findToolSlot: () => ({ x: 0, y: 0 }),
      getContextWindowSize: () => 200000,
      blockIdCounter: { current: 0 },
      skipForceSync: true,
    }
    let state = createEmptyState()
    const emit = (sessionId: string, type: SimulationEvent['type'], payload: Record<string, unknown>) => {
      state = processEvent(scopeSessionEvent({ sessionId, type, payload, time: 1 }), state, ctx)
    }
    for (const id of ['session-a', 'session-b']) {
      emit(id, 'agent_spawn', { name: 'Orchestrator', isMain: true })
      emit(id, 'agent_spawn', { name: 'researcher', parent: 'Orchestrator' })
      emit(id, 'tool_call_start', { agent: 'researcher', tool: 'Read', args: 'README.md' })
    }

    const a = JSON.stringify(['session-a', 'Orchestrator'])
    const b = JSON.stringify(['session-b', 'Orchestrator'])
    const workerA = JSON.stringify(['session-a', 'researcher'])
    const workerB = JSON.stringify(['session-b', 'researcher'])
    expect(state.agents.size).toBe(4)
    expect(state.agents.get(a)?.x).not.toBe(state.agents.get(b)?.x)
    expect(state.agents.get(workerA)).toMatchObject({ name: 'researcher', parentId: a, sessionId: 'session-a' })
    expect(state.agents.get(workerB)).toMatchObject({ name: 'researcher', parentId: b, sessionId: 'session-b' })
    expect(state.toolCalls.size).toBe(2)
    expect(state.edges.filter(edge => edge.type === 'parent-child')).toHaveLength(2)

    emit('session-a', 'message', { agent: 'Orchestrator', role: 'user', content: 'Build the overview' })
    expect(state.agents.get(a)?.name).toBe('Build the overview')
    expect(state.agents.get(b)?.name).toBe('Orchestrator')

    emit('session-b', 'permission_requested', {})
    expect(state.agents.get(b)?.state).toBe('waiting_permission')
    expect(state.agents.get(a)?.state).toBe('thinking')

    emit('session-a', 'agent_complete', { name: 'Orchestrator' })
    expect(state.agents.get(a)?.state).toBe('complete')
    expect(state.agents.get(workerA)?.state).toBe('complete')
    expect(state.agents.get(workerB)?.state).toBe('tool_calling')
    expect(Array.from(state.toolCalls.values()).find(tool => tool.agentId === workerB)?.state).toBe('running')
    expect(ctx.syncForceSimulation).not.toHaveBeenCalled()
  })

  it('removes a finished session root once it has lingered for 60 seconds', () => {
    let state = emitTo(createEmptyState(), 'a', 'agent_spawn', { name: 'Orchestrator', isMain: true })
    state = emitTo(state, 'a', 'agent_complete', { name: 'Orchestrator' })
    const root = JSON.stringify(['a', 'Orchestrator'])

    state = advanceSeconds(state, 59)
    expect(state.agents.has(root)).toBe(true)

    state = advanceSeconds(state, 5)
    expect(state.agents.has(root)).toBe(false)
  })

  it('leaves out session roots that finished over 60 seconds before a seek target', () => {
    let state = emitTo(createEmptyState(), 'a', 'agent_spawn', { name: 'Orchestrator', isMain: true })
    state = emitTo(state, 'a', 'agent_complete', { name: 'Orchestrator' })

    expect(snapVisualState(state, 61).agents.has(JSON.stringify(['a', 'Orchestrator']))).toBe(false)
  })

  it('places a returning session root in a free slot instead of on top of another root', () => {
    let state = createEmptyState()
    for (const id of ['a', 'b', 'c']) state = emitTo(state, id, 'agent_spawn', { name: 'Orchestrator', isMain: true })
    const agents = new Map(state.agents)
    agents.delete(JSON.stringify(['a', 'Orchestrator']))

    state = emitTo({ ...state, agents }, 'a', 'agent_spawn', { name: 'Orchestrator', isMain: true })
    const returning = state.agents.get(JSON.stringify(['a', 'Orchestrator']))
    expect([returning?.x, returning?.y]).toEqual([0, 0])
  })

  it('spreads three session roots around the first one instead of along a row', () => {
    let state = createEmptyState()
    for (const id of ['a', 'b', 'c']) state = emitTo(state, id, 'agent_spawn', { name: 'Orchestrator', isMain: true })
    const [first, second, third] = ['a', 'b', 'c'].map(id => state.agents.get(JSON.stringify([id, 'Orchestrator']))!)

    const crossProduct = (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
    expect(Math.abs(crossProduct)).toBeGreaterThan(1)
  })

  it('preserves raw events for switching back to session tabs', () => {
    const event: SimulationEvent = {
      sessionId: 'a', time: 0, type: 'agent_spawn',
      payload: { name: 'main', parent: null, isMain: true },
    }
    expect(scopeSessionEvent(event).payload.name).not.toBe('main')
    expect(event.payload).toEqual({ name: 'main', parent: null, isMain: true })
  })
})
