import type { SessionInfo } from '../shared/protocol'

export type ConnectionStatus = 'connected' | 'disconnected' | 'watching'

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

export interface VisualizerConfig {
  mode: 'live' | 'replay'
  autoPlay: boolean
  showMockData: boolean
}

export interface DesktopInitialState {
  connectionStatus: ConnectionStatus
  connectionSource: string
  sessions: SessionInfo[]
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

export type WindowSyncState = 'attached' | 'snapshot-sent' | 'snapshot-applied' | 'replaying' | 'live-ready'
