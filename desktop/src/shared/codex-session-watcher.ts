import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { AgentEvent, SessionInfo } from './protocol'
import { ACTIVE_SESSION_AGE_S, INACTIVITY_TIMEOUT_MS, ORCHESTRATOR_NAME, SCAN_INTERVAL_MS } from './constants'
import { CodexTranscriptParser } from './codex-transcript-parser'
import { TypedEventEmitter } from './event-emitter'
import { readCompleteFileLines } from './fs-utils'
import { createLogger } from './logger'
import type { SessionLifecycle, SessionSource } from './session-source'

const log = createLogger('CodexSessionWatcher')
const MAX_REPLAY_EVENTS = 1000

function historicalEvent(event: AgentEvent): AgentEvent {
  return event.type === 'message' && !event.historical ? { ...event, historical: true } : event
}

interface CodexSession {
  info: SessionInfo
  filePath: string
  offset: number
  parser: CodexTranscriptParser
  watcher: fs.FSWatcher | null
  events: AgentEvent[]
  bootstrapping: boolean
  expired: boolean
}

/** Discovers CLI, IDE and desktop Codex rollouts under CODEX_HOME/sessions. */
export class CodexSessionWatcher implements SessionSource {
  private readonly sessions = new Map<string, CodexSession>()
  private readonly files = new Set<string>()
  private rootWatcher: fs.FSWatcher | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private readonly sessionsDir: string
  private readonly events = new TypedEventEmitter<AgentEvent>()
  private readonly detected = new TypedEventEmitter<string>()
  private readonly lifecycle = new TypedEventEmitter<SessionLifecycle>()
  readonly onEvent = this.events.event
  readonly onSessionDetected = this.detected.event
  readonly onSessionLifecycle = this.lifecycle.event

  constructor(options?: { sessionsDir?: string }) {
    this.sessionsDir = options?.sessionsDir ?? path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')
  }

  start(): void {
    if (this.scanTimer) return
    this.forceScan()
    this.scanTimer = setInterval(() => this.forceScan(), SCAN_INTERVAL_MS)
  }

  forceScan(): void {
    // Always poll known files, including resumed sessions in older date directories.
    for (const session of this.sessions.values()) {
      this.readSession(session)
      this.expireSession(session)
    }
    if (!fs.existsSync(this.sessionsDir)) return
    if (!this.rootWatcher) {
      try {
        this.rootWatcher = fs.watch(this.sessionsDir, { recursive: true }, () => {
          if (this.debounceTimer) clearTimeout(this.debounceTimer)
          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            this.forceScan()
          }, 150)
        })
      } catch { /* periodic scans also work where recursive watching is unavailable */ }
    }
    this.scanDirectory(this.sessionsDir, 0)
  }

  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values(), session => ({ ...session.info }))
  }

  buildReplayStartEvents(sessionIds?: string[]): Array<{ sessionId: string; event: AgentEvent }> {
    return Array.from(this.sessions.values())
      .filter(session => !sessionIds || sessionIds.includes(session.info.id))
      .flatMap(session => [this.spawnEvent(session), ...session.events].map(event => ({ sessionId: session.info.id, event: historicalEvent(event) })))
  }

  private scanDirectory(directory: string, depth: number): void {
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name)
        if (entry.isDirectory() && depth < 3) {
          this.scanDirectory(filePath, depth + 1)
        } else if (entry.isFile() && entry.name.endsWith('.jsonl') && !this.files.has(filePath)) {
          try {
            const stat = fs.statSync(filePath)
            if (Date.now() - stat.mtimeMs <= ACTIVE_SESSION_AGE_S * 1000) this.watchSession(filePath)
          } catch { /* file may disappear during a scan */ }
        }
      }
    } catch (error) { log.debug('Cannot scan Codex sessions:', error) }
  }

  private watchSession(filePath: string): void {
    const initial = readCompleteFileLines(filePath, 0)
    if (!initial.lines.length) return
    let meta: { type?: string; payload?: { id?: string; timestamp?: string } }
    try { meta = JSON.parse(initial.lines[0]) } catch { return }
    if (meta?.type !== 'session_meta' || typeof meta.payload?.id !== 'string' || !meta.payload.id) return
    const sessionId = `codex:${meta.payload.id}`
    if (this.sessions.has(sessionId)) return
    const timestamp = Date.parse(meta.payload.timestamp ?? '')
    const session: CodexSession = {
      info: {
        id: sessionId, provider: 'codex', label: 'Codex session', status: 'active',
        startTime: Number.isFinite(timestamp) ? timestamp : Date.now(),
        lastActivityTime: initial.mtime,
      },
      filePath, offset: initial.offset, watcher: null, events: [], bootstrapping: true, expired: false,
      parser: new CodexTranscriptParser({
        emit: event => this.emit(session, event),
        elapsed: () => Math.max(0, (Date.now() - session.info.startTime) / 1000),
        onLabel: label => {
          session.info.label = label
          if (!session.bootstrapping) this.fireLifecycle(session, 'updated')
        },
        onTurnState: active => this.setTurnState(session, active),
      }),
    }
    this.sessions.set(sessionId, session)
    this.files.add(filePath)
    for (const line of initial.lines) session.parser.processLine(line)
    this.expireSession(session)
    session.bootstrapping = false
    this.detected.fire(sessionId)
    this.fireLifecycle(session, 'started')
    this.events.fire({ ...this.spawnEvent(session), sessionId })
    for (const event of session.events) this.events.fire({ ...event, sessionId })
    if (session.info.status === 'completed') this.fireLifecycle(session, 'ended')
    try {
      session.watcher = fs.watch(filePath, () => this.readSession(session))
    } catch { /* periodic polling remains active */ }
  }

  private readSession(session: CodexSession): void {
    try {
      const result = readCompleteFileLines(session.filePath, session.offset)
      session.offset = result.offset
      if (!result.lines.length) return
      session.info.lastActivityTime = result.mtime
      for (const line of result.lines) session.parser.processLine(line)
    } catch { /* a rollout may be moved to archived_sessions while being watched */ }
  }

  private setTurnState(session: CodexSession, active: boolean): void {
    if (active && (session.expired || session.info.status === 'completed')) {
      session.expired = false
      const spawn = this.spawnEvent(session)
      this.emit(session, { ...spawn, payload: { ...spawn.payload, resumed: true }, time: Math.max(0, (Date.now() - session.info.startTime) / 1000) })
    }
    const status = active ? 'active' : 'completed'
    if (session.info.status === status) return
    session.info.status = status
    if (!active) {
      this.emit(session, {
        time: Math.max(0, (Date.now() - session.info.startTime) / 1000),
        type: 'agent_idle', payload: { name: ORCHESTRATOR_NAME, turnComplete: true },
      })
    }
    if (session.bootstrapping) return
    if (active) {
      // A turn completion leaves the agent idle; a resumed turn keeps its history.
      this.fireLifecycle(session, 'started')
    } else {
      this.fireLifecycle(session, 'ended')
    }
  }

  private expireSession(session: CodexSession): void {
    if (session.expired || Date.now() - session.info.lastActivityTime < INACTIVITY_TIMEOUT_MS) return
    this.setTurnState(session, false)
    session.expired = true
    this.emit(session, {
      time: Math.max(0, (Date.now() - session.info.startTime) / 1000),
      type: 'agent_complete', payload: { name: ORCHESTRATOR_NAME },
    })
  }

  private spawnEvent(session: CodexSession): AgentEvent {
    return {
      time: 0, type: 'agent_spawn',
      payload: { name: ORCHESTRATOR_NAME, isMain: true, provider: 'codex', task: session.info.label, ...(session.parser.model ? { model: session.parser.model } : {}) },
    }
  }

  private emit(session: CodexSession, event: AgentEvent): void {
    // Keep past conversation entries for Chat/Review without announcing them as new bubbles.
    if (session.bootstrapping) event = historicalEvent(event)
    session.events.push(event)
    if (session.events.length > MAX_REPLAY_EVENTS) session.events.shift()
    if (!session.bootstrapping) this.events.fire({ ...event, sessionId: session.info.id })
  }

  private fireLifecycle(session: CodexSession, type: SessionLifecycle['type']): void {
    this.lifecycle.fire({ type, sessionId: session.info.id, label: session.info.label })
  }

  dispose(): void {
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.scanTimer = null
    this.debounceTimer = null
    this.rootWatcher?.close()
    this.rootWatcher = null
    for (const session of this.sessions.values()) session.watcher?.close()
    this.sessions.clear()
    this.files.clear()
    this.events.dispose()
    this.detected.dispose()
    this.lifecycle.dispose()
  }
}
