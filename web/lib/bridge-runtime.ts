import { createVSCodeBridge } from './vscode-bridge'

export interface VisualizerConfig {
  mode: string
  autoPlay: boolean
  showMockData: boolean
}

export interface DesktopSettings {
  claudeProjectsPath: string
  openFileStrategy: 'auto' | 'vscode' | 'cursor' | 'system'
  editorCommandTemplate: string | null
  hooks: {
    enabled: boolean
    lastConfiguredAt: string | null
    diagnosticsDismissed: boolean
  }
  ui: {
    windowBounds: {
      width: number
      height: number
      x?: number
      y?: number
    } | null
  }
}

export interface DesktopInitialState {
  connectionStatus: 'connected' | 'disconnected' | 'watching'
  connectionSource: string
  sessions: import('./bridge-types').SessionInfo[]
  config: VisualizerConfig
  desktopSettings: DesktopSettings
}

export interface DesktopHookStatus {
  hookServerRunning: boolean
  hookPort: number | null
  discoveryMode: 'global'
  globalDiscoveryFileExists: boolean
  hookScriptInstalled: boolean
  claudeSettingsHasAgentFlowHooks: boolean
  lastError: string | null
}

export type EventCallback = (event: import('./bridge-types').AgentEvent) => void
export type StatusCallback = (status: import('./bridge-types').ConnectionStatus, source: string) => void
export type ConfigCallback = (config: VisualizerConfig) => void
export type SessionCallback = (
  type: 'list' | 'started' | 'ended' | 'updated' | 'reset',
  data: import('./bridge-types').SessionInfo[] | import('./bridge-types').SessionInfo | string | { sessionId: string; label: string },
) => void

export interface BridgeAdapter {
  /** Whether the bridge is connected to a host (VS Code or Electron). Named for legacy compatibility. */
  readonly isVSCode: boolean
  onEvent(cb: EventCallback): () => void
  onStatus(cb: StatusCallback): () => void
  onConfig(cb: ConfigCallback): () => void
  onSession(cb: SessionCallback): () => void
  getInitialState?(): Promise<DesktopInitialState | null>
  notifyInitialStateApplied?(): void
  getSettings?(): Promise<DesktopSettings>
  updateSettings?(partial: Partial<DesktopSettings>): Promise<DesktopSettings>
  configureHooks?(): Promise<DesktopHookStatus>
  getHooksStatus?(): Promise<DesktopHookStatus>
  openClaudeSettings?(): Promise<void>
  openFile(filePath: string, line?: number): void
  dispose(): void
}

let activeBridge: BridgeAdapter | null = null
let fallbackBridge: BridgeAdapter | null = null

export function setActiveBridge(bridge: BridgeAdapter): void {
  activeBridge = bridge
}

export function getActiveBridge(): BridgeAdapter | null {
  if (activeBridge) return activeBridge
  if (typeof window === 'undefined') return null
  if (!fallbackBridge) {
    fallbackBridge = createVSCodeBridge()
  }
  return fallbackBridge
}

export function resetBridgeForTests(): void {
  activeBridge?.dispose?.()
  fallbackBridge?.dispose?.()
  activeBridge = null
  fallbackBridge = null
}
