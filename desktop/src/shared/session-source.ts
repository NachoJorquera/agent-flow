import type { Disposable } from './event-emitter'
import type { AgentEvent, SessionInfo } from './protocol'

export interface SessionLifecycle {
  type: 'started' | 'ended' | 'updated'
  sessionId: string
  label: string
}

/** Common contract for local session providers. */
export interface SessionSource extends Disposable {
  onEvent(listener: (event: AgentEvent) => void): Disposable
  onSessionDetected(listener: (sessionId: string) => void): Disposable
  onSessionLifecycle(listener: (event: SessionLifecycle) => void): Disposable
  start(): void
  forceScan(): void
  getActiveSessions(): SessionInfo[]
  buildReplayStartEvents(sessionIds?: string[]): Array<{ sessionId: string; event: AgentEvent }>
}
