import { describe, expect, it, vi } from 'vitest'
import { routeIncomingHookEvent } from './event-dedup'
import { ORCHESTRATOR_NAME } from './constants'

describe('routeIncomingHookEvent', () => {
  it('converts orchestrator agent_complete to agent_idle', () => {
    const event = routeIncomingHookEvent({
      type: 'agent_complete',
      time: 1,
      sessionId: 's1',
      payload: { name: ORCHESTRATOR_NAME },
    }, {
      isActive: () => true,
      isSessionActive: () => true,
    })

    expect(event?.type).toBe('agent_idle')
  })

  it('keeps sessionEnd completions intact', () => {
    const event = routeIncomingHookEvent({
      type: 'agent_complete',
      time: 1,
      sessionId: 's1',
      payload: { name: ORCHESTRATOR_NAME, sessionEnd: true },
    }, {
      isActive: () => true,
      isSessionActive: () => true,
    })

    expect(event?.type).toBe('agent_complete')
  })

  it('filters subagent lifecycle when watcher owns session', () => {
    const event = routeIncomingHookEvent({
      type: 'subagent_dispatch',
      time: 1,
      sessionId: 's1',
      payload: { name: 'SubAgent' },
    }, {
      isActive: () => true,
      isSessionActive: vi.fn(() => true),
    })

    expect(event).toBeNull()
  })

  it('passes subagent tool events when watcher owns session', () => {
    const event = routeIncomingHookEvent({
      type: 'tool_call_start',
      time: 1,
      sessionId: 's1',
      payload: { name: 'SubAgent' },
    }, {
      isActive: () => true,
      isSessionActive: vi.fn(() => true),
    })

    expect(event?.type).toBe('tool_call_start')
  })

  it('passes events untouched when watcher does not know session', () => {
    const sourceEvent = {
      type: 'agent_complete',
      time: 1,
      sessionId: 's9',
      payload: { name: 'SubAgent' },
    } as const
    const event = routeIncomingHookEvent(sourceEvent, {
      isActive: () => true,
      isSessionActive: vi.fn(() => false),
    })

    expect(event).toEqual(sourceEvent)
  })
})
