import { ORCHESTRATOR_NAME } from './constants'
import type { AgentEvent, SessionInfo } from './protocol'

export interface DelegatedSessionLink {
  sessionId: string
  parentSessionId: string
  agentName: string
  parentAgentName: string
}

interface Reference extends Omit<DelegatedSessionLink, 'sessionId'> {
  childThreadId?: string
  childSessionId?: string
}

/** Joins a delegation placeholder and the provider's real transcript using explicit IDs. */
export class DelegatedSessionRouter {
  private readonly references = new Map<string, Reference>()
  private readonly links = new Map<string, DelegatedSessionLink>()

  constructor(
    private readonly resolveThread: (threadId: string) => string | undefined,
    private readonly getSession: (sessionId: string) => SessionInfo | undefined,
  ) {}

  observe(event: AgentEvent): void {
    if (!event.sessionId || (event.type !== 'agent_spawn' && event.type !== 'agent_link')) return
    const { name, parent, childThreadId, childSessionId } = event.payload
    if (typeof name !== 'string' || (typeof childThreadId !== 'string' && typeof childSessionId !== 'string')) return
    this.references.set(JSON.stringify([event.sessionId, name]), {
      parentSessionId: event.sessionId, agentName: name,
      parentAgentName: typeof parent === 'string' ? parent : ORCHESTRATOR_NAME,
      childThreadId: typeof childThreadId === 'string' ? childThreadId : undefined,
      childSessionId: typeof childSessionId === 'string' ? childSessionId : undefined,
    })
  }

  refresh(): DelegatedSessionLink[] {
    const added: DelegatedSessionLink[] = []
    for (const reference of this.references.values()) {
      const sessionId = reference.childSessionId ?? (reference.childThreadId ? this.resolveThread(reference.childThreadId) : undefined)
      if (!sessionId || this.links.has(sessionId) || this.contains(reference.parentSessionId, sessionId)) continue
      const link = { sessionId, parentSessionId: reference.parentSessionId, agentName: reference.agentName, parentAgentName: reference.parentAgentName }
      this.links.set(sessionId, link)
      added.push(link)
    }
    return added
  }

  isLinked(sessionId: string): boolean {
    return this.links.has(sessionId)
  }

  contains(sessionId: string, ancestor: string): boolean {
    let current: string | undefined = sessionId
    while (current) {
      if (current === ancestor) return true
      current = this.links.get(current)?.parentSessionId
    }
    return false
  }

  depth(sessionId: string): number {
    let depth = 0
    for (let link = this.links.get(sessionId); link; link = this.links.get(link.parentSessionId)) depth++
    return depth
  }

  root(sessionId: string): string {
    let link = this.links.get(sessionId)
    while (link) {
      sessionId = link.parentSessionId
      link = this.links.get(sessionId)
    }
    return sessionId
  }

  route(event: AgentEvent): AgentEvent | null {
    if (event.type === 'agent_link') return null
    if (!event.sessionId) return event
    const link = this.links.get(event.sessionId)
    if (!link) return event
    const payload = { ...event.payload }
    const rootSpawn = event.type === 'agent_spawn' && payload.isMain === true
    if (event.type === 'agent_spawn') payload.displayName = payload.displayName ?? payload.name
    const rename = (name: string) => name === ORCHESTRATOR_NAME ? link.agentName : JSON.stringify([link.sessionId, name])
    for (const key of ['name', 'agent', 'parent', 'child'] as const) {
      if (typeof payload[key] === 'string') payload[key] = rename(payload[key])
    }
    if (rootSpawn) {
      payload.name = link.agentName
      payload.displayName = link.agentName
      payload.parent = link.parentAgentName
      payload.isMain = false
    }
    const complete = event.type === 'agent_idle' && event.payload.name === ORCHESTRATOR_NAME && payload.turnComplete === true
    const child = this.getSession(link.sessionId)
    const parent = this.getSession(link.parentSessionId)
    return this.route({
      ...event, type: complete ? 'agent_complete' : event.type, payload,
      sessionId: link.parentSessionId,
      time: Math.max(0, event.time + (child && parent ? (child.startTime - parent.startTime) / 1000 : 0)),
    })
  }
}
