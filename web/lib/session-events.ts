import type { SimulationEvent } from './agent-types'

/** Loading buffered conversation history must not redisplay it as fresh canvas activity. */
export function historicalEvent(event: SimulationEvent): SimulationEvent {
  return event.type === 'message' && !event.historical ? { ...event, historical: true } : event
}

/** Keep agent identities independent when multiple sessions share one simulation. */
export function scopeSessionEvent(event: SimulationEvent): SimulationEvent {
  if (!event.sessionId) return event

  const payload: Record<string, unknown> = { ...event.payload, sessionId: event.sessionId }
  if (event.type === 'agent_spawn') {
    Object.assign(payload, { displayName: event.payload.displayName ?? event.payload.name })
  }
  if (event.type === 'permission_requested' && typeof payload.agent !== 'string') {
    payload.agent = 'Orchestrator'
  }
  for (const key of ['name', 'agent', 'parent', 'child'] as const) {
    if (typeof payload[key] === 'string') {
      payload[key] = JSON.stringify([event.sessionId, payload[key]])
    }
  }
  return { ...event, payload }
}
