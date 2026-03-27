/**
 * Shared types for the bridge protocol.
 *
 * These types mirror desktop/src/shared/protocol.ts and are kept separate
 * to avoid cross-project imports. When updating these, also update
 * the canonical definitions in desktop/src/shared/protocol.ts.
 */

export interface AgentEvent {
  time: number
  type: string
  payload: Record<string, unknown>
  sessionId?: string
}

export interface SessionInfo {
  id: string
  label: string
  status: 'active' | 'completed'
  startTime: number
  lastActivityTime: number
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'watching'
