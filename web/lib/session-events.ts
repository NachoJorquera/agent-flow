import type { SimulationEvent } from './agent-types'

/** Keep agent identities independent when multiple sessions share one simulation. */
export function scopeSessionEvent(event: SimulationEvent): SimulationEvent {
  if (!event.sessionId) return event

  const payload: Record<string, unknown> = { ...event.payload, sessionId: event.sessionId }
  if (event.type === 'agent_spawn') {
    Object.assign(payload, { displayName: event.payload.name })
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
