import { AgentEvent } from './protocol'
import { ORCHESTRATOR_NAME } from './constants'

const SUBAGENT_LIFECYCLE_EVENTS = ['agent_spawn', 'subagent_dispatch', 'subagent_return', 'agent_complete']

function filterOrchestratorCompletion(event: AgentEvent): AgentEvent | null {
  if (event.type !== 'agent_complete') return event
  const agentName = event.payload?.agent ?? event.payload?.name
  const isOrchestrator = agentName === ORCHESTRATOR_NAME || !agentName
  if (!isOrchestrator) return event
  if (event.payload?.sessionEnd) return event
  return { ...event, type: 'agent_idle' }
}

export function routeIncomingHookEvent(
  event: AgentEvent,
  sessionWatcher: Pick<{ isActive(): boolean; isSessionActive(sessionId: string): boolean }, 'isActive' | 'isSessionActive'>,
): AgentEvent | null {
  const eventSessionId = event.sessionId
  const sessionWatcherHandlesThis = eventSessionId
    ? sessionWatcher.isSessionActive(eventSessionId)
    : sessionWatcher.isActive()

  if (!sessionWatcherHandlesThis) return event

  const agentName = event.payload?.agent ?? event.payload?.name
  const isOrchestrator = agentName === ORCHESTRATOR_NAME || !agentName

  if (isOrchestrator) {
    return filterOrchestratorCompletion(event)
  }

  if (SUBAGENT_LIFECYCLE_EVENTS.includes(event.type)) return null

  return event
}

