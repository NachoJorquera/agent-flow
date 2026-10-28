import { BrowserWindow, shell } from 'electron'
import { HookServer } from '../shared/hook-server'
import { AgentEvent, SessionInfo, type SessionMerge } from '../shared/protocol'
import { SessionWatcher } from '../shared/session-watcher'
import { CodexSessionWatcher } from '../shared/codex-session-watcher'
import { T3SessionTitles } from '../shared/t3-session-titles'
import { DelegatedSessionRouter } from '../shared/delegated-session-router'
import { ORCHESTRATOR_NAME } from '../shared/constants'
import type { SessionSource } from '../shared/session-source'
import { routeIncomingHookEvent } from '../shared/event-dedup'
import {
  ensureHookScript,
  globalDiscoveryFileExists,
  removeGlobalDiscoveryFile,
  writeGlobalDiscoveryFile,
} from '../shared/discovery'
import { configureClaudeHooks, hasAgentFlowHooks, migrateHttpHooks } from '../shared/hooks-config'
import { createLogger } from '../shared/logger'
import { openFileWithStrategy } from './open-file'
import { getClaudeSettingsPath } from './paths'
import { PowerSaveManager } from './power-save'
import { SettingsStore } from './settings-store'
import { DesktopHookStatus, DesktopInitialState, VisualizerConfig, WindowSyncState } from './types'

const log = createLogger('DesktopServiceManager')

interface ManagedWindow {
  win: BrowserWindow
  state: WindowSyncState
  buffer: Array<{ channel: string; args: unknown[] }>
}

interface ServiceManagerDeps {
  sessionWatcher?: SessionWatcher
  codexSessionWatcher?: SessionSource
  sessionTitles?: Pick<T3SessionTitles, 'get' | 'getSessionId' | 'start' | 'refresh' | 'onChange' | 'dispose'>
  powerSave?: PowerSaveManager
  hookServerFactory?: () => HookServer
}

export class ServiceManager {
  private readonly sessionWatcher: SessionWatcher
  private readonly sessionSources: SessionSource[]
  private readonly sessionTitles: NonNullable<ServiceManagerDeps['sessionTitles']>
  private readonly sessionRouter: DelegatedSessionRouter
  private readonly deferredCompletions = new Map<string, AgentEvent>()
  private readonly originalPayloads = new WeakMap<AgentEvent['payload'], AgentEvent['payload']>()
  private hookServer: HookServer | null = null
  private hookPort: number | null = null
  private readonly windows = new Map<number, ManagedWindow>()
  private connectionStatus: 'connected' | 'disconnected' | 'watching' = 'watching'
  private connectionSource = 'Session watcher'
  private readonly powerSave: PowerSaveManager
  private readonly hookServerFactory: () => HookServer

  constructor(private readonly settingsStore: SettingsStore, deps: ServiceManagerDeps = {}) {
    this.sessionWatcher = deps.sessionWatcher ?? new SessionWatcher({ claudeDir: this.settingsStore.get().claudeProjectsPath })
    this.sessionSources = [this.sessionWatcher, deps.codexSessionWatcher ?? new CodexSessionWatcher()]
    this.sessionTitles = deps.sessionTitles ?? new T3SessionTitles()
    this.sessionRouter = new DelegatedSessionRouter(
      threadId => this.sessionTitles.getSessionId(threadId),
      sessionId => this.sessionSources.flatMap(source => source.getActiveSessions()).find(session => session.id === sessionId),
    )
    this.powerSave = deps.powerSave ?? new PowerSaveManager()
    this.hookServerFactory = deps.hookServerFactory ?? (() => new HookServer())
  }

  async start(): Promise<void> {
    this.sessionTitles.onChange(sessionIds => {
      this.syncDelegatedSessions()
      for (const session of this.visibleSessions()) {
        if (sessionIds.includes(session.id)) {
          this.broadcast('sessions:updated', { sessionId: session.id, label: this.withSessionTitle(session).label })
        }
      }
    })
    await this.sessionTitles.start()
    for (const source of this.sessionSources) {
      source.onEvent((event) => {
        this.sessionRouter.observe(event)
        this.syncDelegatedSessions()
        const routed = this.displayEvent(event)
        if (routed) this.broadcast('agent:event', routed)
        this.flushDeferredCompletions()
      })
      source.onSessionDetected((_sessionId) => {
        this.connectionStatus = 'watching'
        this.connectionSource = this.hookPort ? `Hooks :${this.hookPort} + session watcher` : 'Session watcher'
        this.broadcast('connection:status', this.connectionStatus, this.connectionSource)
      })
      source.onSessionLifecycle((lifecycle) => {
        this.updatePowerSaveState()
        if (this.sessionRouter.isLinked(lifecycle.sessionId)) return
        if (lifecycle.type === 'ended' && this.hasActiveChildren(lifecycle.sessionId)) return
        if (lifecycle.type === 'started') {
          const session = source.getActiveSessions().find(s => s.id === lifecycle.sessionId) ?? {
            id: lifecycle.sessionId,
            label: lifecycle.label,
            status: 'active' as const,
            startTime: Date.now(),
            lastActivityTime: Date.now(),
          }
          this.broadcast('sessions:started', this.withSessionTitle(session))
        } else if (lifecycle.type === 'updated') {
          this.broadcast('sessions:updated', { sessionId: lifecycle.sessionId, label: this.sessionTitles.get(lifecycle.sessionId) ?? lifecycle.label })
        } else {
          this.broadcast('sessions:ended', lifecycle.sessionId)
        }
      })
      source.start()
    }
    this.updatePowerSaveState()

    if (this.settingsStore.get().hooks.enabled) {
      await this.startHooks()
    }
  }

  async stop(): Promise<void> {
    removeGlobalDiscoveryFile()
    this.hookServer?.dispose()
    this.hookServer = null
    this.hookPort = null
    for (const source of this.sessionSources) source.dispose()
    this.sessionTitles.dispose()
    this.powerSave.dispose()
  }

  attachWindow(win: BrowserWindow): void {
    this.windows.set(win.id, { win, state: 'attached', buffer: [] })
    win.on('closed', () => {
      this.windows.delete(win.id)
    })
  }

  markSnapshotSent(win: BrowserWindow): void {
    const managed = this.windows.get(win.id)
    if (managed) managed.state = 'snapshot-sent'
  }

  markInitialStateApplied(win: BrowserWindow): void {
    const managed = this.windows.get(win.id)
    if (!managed) return
    managed.state = 'snapshot-applied'
    managed.win.webContents.send('app:beginReplay')
    managed.state = 'replaying'
    const replayedPayloads = new Set<AgentEvent['payload']>()
    for (const replayEvent of this.replayEvents()) {
      replayedPayloads.add(replayEvent.event.payload)
      const event = this.displayEvent({ ...replayEvent.event, sessionId: replayEvent.sessionId })
      if (event) managed.win.webContents.send('agent:event', event)
    }
    managed.win.webContents.send('app:replayComplete')
    managed.state = 'live-ready'
    for (const buffered of managed.buffer) {
      // A provider may retain history that already includes events buffered during bootstrap.
      if (buffered.channel === 'agent:event') {
        const payload = (buffered.args[0] as AgentEvent).payload
        if (replayedPayloads.has(this.originalPayloads.get(payload) ?? payload)) continue
      }
      if (buffered.channel === 'agent:event') {
        const event = this.displayEvent(buffered.args[0] as AgentEvent)
        if (event) managed.win.webContents.send(buffered.channel, event)
        continue
      }
      if (buffered.channel === 'sessions:merged') {
        managed.win.webContents.send(buffered.channel, { ...buffered.args[0] as SessionMerge, events: [] })
        continue
      }
      const sessionId = buffered.channel === 'sessions:ended' ? buffered.args[0]
        : buffered.channel === 'sessions:updated' ? (buffered.args[0] as { sessionId: string }).sessionId
        : buffered.channel === 'sessions:started' ? (buffered.args[0] as SessionInfo).id : undefined
      if (typeof sessionId === 'string' && this.sessionRouter.isLinked(sessionId)) continue
      managed.win.webContents.send(buffered.channel, ...buffered.args)
    }
    managed.buffer.length = 0
  }

  getInitialState(): DesktopInitialState {
    const config: VisualizerConfig = { mode: 'live', autoPlay: true, showMockData: false }
    return {
      connectionStatus: this.connectionStatus,
      connectionSource: this.connectionSource,
      sessions: this.visibleSessions().map(session => this.withSessionTitle(session)),
      config,
      desktopSettings: this.settingsStore.get(),
    }
  }

  async openFile(filePath: string, line?: number): Promise<void> {
    await openFileWithStrategy(this.settingsStore.get(), filePath, line)
  }

  async configureHooks(): Promise<DesktopHookStatus> {
    const result = await configureClaudeHooks()
    if (result.ok) {
      this.settingsStore.update({ hooks: { enabled: true, lastConfiguredAt: new Date().toISOString(), diagnosticsDismissed: false } })
      if (!this.hookServer) {
        await this.startHooks()
      }
    }
    return this.getHooksStatus(result.error ?? null)
  }

  getHooksStatus(lastError: string | null = null): DesktopHookStatus {
    return {
      hookServerRunning: !!this.hookServer,
      hookPort: this.hookPort,
      discoveryMode: 'global',
      globalDiscoveryFileExists: globalDiscoveryFileExists(),
      hookScriptInstalled: true,
      claudeSettingsHasAgentFlowHooks: hasAgentFlowHooks(getClaudeSettingsPath()),
      lastError,
    }
  }

  async openClaudeSettings(): Promise<void> {
    await shell.openPath(getClaudeSettingsPath())
  }

  updateSettings(partial: Parameters<SettingsStore['update']>[0]) {
    const settings = this.settingsStore.update(partial)
    this.broadcast('settings:updated', settings)
    return settings
  }

  getSettings() {
    return this.settingsStore.get()
  }

  forceImmediateScan(): void {
    void this.sessionTitles.refresh()
    for (const source of this.sessionSources) source.forceScan()
  }

  private withSessionTitle(session: SessionInfo): SessionInfo {
    const title = this.sessionTitles.get(session.id)
    return title ? { ...session, label: title } : session
  }

  private visibleSessions(): SessionInfo[] {
    return this.sessionSources.flatMap(source => source.getActiveSessions())
      .filter(session => !this.sessionRouter.isLinked(session.id))
      .map(session => this.hasActiveChildren(session.id) ? { ...session, status: 'active' } : session)
  }

  private hasActiveChildren(sessionId: string): boolean {
    return this.sessionSources.some(source => source.getActiveSessions().some(session =>
      session.id !== sessionId && session.status === 'active' && this.sessionRouter.contains(session.id, sessionId)))
  }

  private displayEvent(event: AgentEvent): AgentEvent | null {
    const routed = this.sessionRouter.route(event)
    if (routed && routed.payload !== event.payload) this.originalPayloads.set(routed.payload, event.payload)
    if (routed?.sessionId && routed.payload.name === ORCHESTRATOR_NAME) {
      if (routed.type === 'agent_spawn') this.deferredCompletions.delete(routed.sessionId)
      if (routed.type === 'agent_complete' && this.hasActiveChildren(routed.sessionId)) {
        this.deferredCompletions.set(routed.sessionId, routed)
        return null
      }
    }
    return routed
  }

  private flushDeferredCompletions(): void {
    for (const [sessionId, event] of this.deferredCompletions) {
      if (this.hasActiveChildren(sessionId)) continue
      this.deferredCompletions.delete(sessionId)
      this.broadcast('agent:event', event)
      this.broadcast('sessions:ended', sessionId)
    }
  }

  private replayEvents() {
    const events = this.sessionSources.flatMap(source => source.buildReplayStartEvents())
    for (const { sessionId, event } of events) this.sessionRouter.observe({ ...event, sessionId })
    this.syncDelegatedSessions()
    return events.sort((a, b) => this.sessionRouter.depth(a.sessionId) - this.sessionRouter.depth(b.sessionId))
  }

  private syncDelegatedSessions(): void {
    for (const link of this.sessionRouter.refresh()) {
      const events = this.sessionSources.flatMap(source => source.buildReplayStartEvents())
        .filter(({ sessionId }) => this.sessionRouter.contains(sessionId, link.sessionId))
        .sort((a, b) => this.sessionRouter.depth(a.sessionId) - this.sessionRouter.depth(b.sessionId))
        .flatMap(({ sessionId, event }) => {
          const routed = this.sessionRouter.route({ ...event, sessionId })
          return routed ? [routed] : []
        })
      const merge: SessionMerge = { sessionId: link.sessionId, parentSessionId: this.sessionRouter.root(link.parentSessionId), events }
      this.broadcast('sessions:merged', merge)
    }
  }

  private async startHooks(): Promise<void> {
    ensureHookScript()
    migrateHttpHooks()
    this.hookServer = this.hookServerFactory()
    this.hookPort = await this.hookServer.start().catch((err) => {
      log.error('Failed to start hook server:', err)
      return null
    })
    if (!this.hookPort || this.hookPort < 0) {
      this.hookServer = null
      this.hookPort = null
      return
    }
    writeGlobalDiscoveryFile(this.hookPort)
    this.connectionSource = `Hooks :${this.hookPort} + session watcher`
    this.broadcast('connection:status', this.connectionStatus, this.connectionSource)
    this.hookServer.onEvent((event) => {
      const routed = routeIncomingHookEvent(event, this.sessionWatcher)
      if (routed) this.broadcast('agent:event', routed)
    })
  }

  private broadcast(channel: string, ...args: unknown[]): void {
    for (const managed of this.windows.values()) {
      if (managed.state === 'live-ready') {
        managed.win.webContents.send(channel, ...args)
      } else {
        managed.buffer.push({ channel, args })
      }
    }
  }

  private updatePowerSaveState(): void {
    const activeCount = this.visibleSessions().filter((s: SessionInfo) => s.status === 'active').length
    this.powerSave.update(activeCount)
  }
}
