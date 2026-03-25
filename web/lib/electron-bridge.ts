import type { AgentEvent, ConnectionStatus, SessionInfo } from './bridge-types'
import type {
  BridgeAdapter, ConfigCallback, DesktopHookStatus, DesktopInitialState, DesktopSettings,
  EventCallback, SessionCallback, StatusCallback,
} from './bridge-runtime'

type Unsubscribe = () => void

interface ElectronAPI {
  getInitialState(): Promise<DesktopInitialState>
  notifyInitialStateApplied(): void
  openFile(filePath: string, line?: number): void
  writeLog(level: 'info' | 'warn' | 'error', message: string): void
  getSettings(): Promise<DesktopSettings>
  updateSettings(partial: Partial<DesktopSettings>): Promise<DesktopSettings>
  configureHooks(): Promise<DesktopHookStatus>
  getHooksStatus(): Promise<DesktopHookStatus>
  openClaudeSettings(): Promise<void>
  onAgentEvent(cb: (event: AgentEvent) => void): Unsubscribe
  onConnectionStatus(cb: (status: ConnectionStatus, source: string) => void): Unsubscribe
  onSessionList(cb: (sessions: SessionInfo[]) => void): Unsubscribe
  onSessionStarted(cb: (session: SessionInfo) => void): Unsubscribe
  onSessionUpdated(cb: (data: { sessionId: string; label: string }) => void): Unsubscribe
  onSessionEnded(cb: (sessionId: string) => void): Unsubscribe
  onReset(cb: (reason: string) => void): Unsubscribe
  onConfig(cb: (config: { mode: string; autoPlay: boolean; showMockData: boolean }) => void): Unsubscribe
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export class ElectronBridge implements BridgeAdapter {
  private readonly api = typeof window !== 'undefined' ? window.electronAPI : undefined
  private readonly eventListeners: EventCallback[] = []
  private readonly statusListeners: StatusCallback[] = []
  private readonly configListeners: ConfigCallback[] = []
  private readonly sessionListeners: SessionCallback[] = []
  private readonly disposers: Unsubscribe[] = []

  constructor() {
    if (!this.api) return

    this.disposers.push(
      this.api.onAgentEvent((event) => {
        for (const cb of this.eventListeners) cb(event)
      }),
      this.api.onConnectionStatus((status, source) => {
        for (const cb of this.statusListeners) cb(status, source)
      }),
      this.api.onConfig((config) => {
        for (const cb of this.configListeners) cb(config)
      }),
      this.api.onSessionList((sessions) => {
        for (const cb of this.sessionListeners) cb('list', sessions)
      }),
      this.api.onSessionStarted((session) => {
        for (const cb of this.sessionListeners) cb('started', session)
      }),
      this.api.onSessionUpdated((data) => {
        for (const cb of this.sessionListeners) cb('updated', data)
      }),
      this.api.onSessionEnded((sessionId) => {
        for (const cb of this.sessionListeners) cb('ended', sessionId)
      }),
      this.api.onReset((reason) => {
        for (const cb of this.sessionListeners) cb('reset', reason)
      }),
    )
  }

  get isVSCode(): boolean {
    return true
  }

  private subscribe<T>(listeners: T[], callback: T): () => void {
    listeners.push(callback)
    return () => {
      const idx = listeners.indexOf(callback)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }

  onEvent(callback: EventCallback): () => void {
    return this.subscribe(this.eventListeners, callback)
  }

  onStatus(callback: StatusCallback): () => void {
    return this.subscribe(this.statusListeners, callback)
  }

  onConfig(callback: ConfigCallback): () => void {
    return this.subscribe(this.configListeners, callback)
  }

  onSession(callback: SessionCallback): () => void {
    return this.subscribe(this.sessionListeners, callback)
  }

  async getInitialState(): Promise<DesktopInitialState | null> {
    return this.api ? this.api.getInitialState() : null
  }

  notifyInitialStateApplied(): void {
    this.api?.notifyInitialStateApplied()
  }

  getSettings(): Promise<DesktopSettings> {
    if (!this.api) return Promise.reject(new Error('Electron API unavailable'))
    return this.api.getSettings()
  }

  updateSettings(partial: Partial<DesktopSettings>): Promise<DesktopSettings> {
    if (!this.api) return Promise.reject(new Error('Electron API unavailable'))
    return this.api.updateSettings(partial)
  }

  configureHooks(): Promise<DesktopHookStatus> {
    if (!this.api) return Promise.reject(new Error('Electron API unavailable'))
    return this.api.configureHooks()
  }

  getHooksStatus(): Promise<DesktopHookStatus> {
    if (!this.api) return Promise.reject(new Error('Electron API unavailable'))
    return this.api.getHooksStatus()
  }

  openClaudeSettings(): Promise<void> {
    if (!this.api) return Promise.reject(new Error('Electron API unavailable'))
    return this.api.openClaudeSettings()
  }

  openFile(filePath: string, line?: number): void {
    this.api?.openFile(filePath, line)
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
  }
}
