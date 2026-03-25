import { BrowserWindow, shell } from 'electron'
import { HookServer } from '../shared/hook-server'
import { AgentEvent, SessionInfo } from '../shared/protocol'
import { SessionWatcher } from '../shared/session-watcher'
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
  powerSave?: PowerSaveManager
  hookServerFactory?: () => HookServer
}

export class ServiceManager {
  private readonly sessionWatcher: SessionWatcher
  private hookServer: HookServer | null = null
  private hookPort: number | null = null
  private readonly windows = new Map<number, ManagedWindow>()
  private connectionStatus: 'connected' | 'disconnected' | 'watching' = 'watching'
  private connectionSource = 'Session watcher'
  private readonly powerSave: PowerSaveManager
  private readonly hookServerFactory: () => HookServer

  constructor(private readonly settingsStore: SettingsStore, deps: ServiceManagerDeps = {}) {
    this.sessionWatcher = deps.sessionWatcher ?? new SessionWatcher({ claudeDir: this.settingsStore.get().claudeProjectsPath })
    this.powerSave = deps.powerSave ?? new PowerSaveManager()
    this.hookServerFactory = deps.hookServerFactory ?? (() => new HookServer())
  }

  async start(): Promise<void> {
    this.sessionWatcher.onEvent((event) => {
      this.broadcast('agent:event', event)
    })
    this.sessionWatcher.onSessionDetected((_sessionId) => {
      this.connectionStatus = 'watching'
      this.connectionSource = this.hookPort ? `Hooks :${this.hookPort} + session watcher` : 'Session watcher'
      this.broadcast('connection:status', this.connectionStatus, this.connectionSource)
    })
    this.sessionWatcher.onSessionLifecycle((lifecycle) => {
      this.updatePowerSaveState()
      if (lifecycle.type === 'started') {
        const session = this.sessionWatcher.getActiveSessions().find(s => s.id === lifecycle.sessionId) ?? {
          id: lifecycle.sessionId,
          label: lifecycle.label,
          status: 'active' as const,
          startTime: Date.now(),
          lastActivityTime: Date.now(),
        }
        this.broadcast('sessions:started', session)
      } else if (lifecycle.type === 'updated') {
        this.broadcast('sessions:updated', { sessionId: lifecycle.sessionId, label: lifecycle.label })
      } else {
        this.broadcast('sessions:ended', lifecycle.sessionId)
      }
    })
    this.sessionWatcher.start()
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
    this.sessionWatcher.dispose()
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
    const activeSessionIds = this.sessionWatcher.getActiveSessions().map(s => s.id)
    for (const replayEvent of this.sessionWatcher.buildReplayStartEvents(activeSessionIds)) {
      managed.win.webContents.send('agent:event', { ...replayEvent.event, sessionId: replayEvent.sessionId })
    }
    managed.win.webContents.send('app:replayComplete')
    managed.state = 'live-ready'
    for (const buffered of managed.buffer) {
      managed.win.webContents.send(buffered.channel, ...buffered.args)
    }
    managed.buffer.length = 0
  }

  getInitialState(): DesktopInitialState {
    const config: VisualizerConfig = { mode: 'live', autoPlay: true, showMockData: false }
    return {
      connectionStatus: this.connectionStatus,
      connectionSource: this.connectionSource,
      sessions: this.sessionWatcher.getActiveSessions(),
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
    return this.settingsStore.update(partial)
  }

  getSettings() {
    return this.settingsStore.get()
  }

  forceImmediateScan(): void {
    this.sessionWatcher.forceScan()
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
    const activeCount = this.sessionWatcher.getActiveSessions().filter((s: SessionInfo) => s.status === 'active').length
    this.powerSave.update(activeCount)
  }
}
