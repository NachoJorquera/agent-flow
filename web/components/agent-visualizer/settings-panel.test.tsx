import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resetBridgeForTests, setActiveBridge, type BridgeAdapter } from '@/lib/bridge-runtime'
import { SettingsPanel } from './settings-panel'

function createDesktopBridge() {
  const getSettings = vi.fn(async () => ({
    claudeProjectsPath: '~/.claude/projects',
    openFileStrategy: 'auto' as const,
    editorCommandTemplate: null,
    hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
    ui: { windowBounds: null },
  }))
  const updateSettings = vi.fn(async (partial) => ({
    claudeProjectsPath: partial.claudeProjectsPath ?? '~/.claude/projects',
    openFileStrategy: partial.openFileStrategy ?? 'auto',
    editorCommandTemplate: partial.editorCommandTemplate ?? null,
    hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
    ui: { windowBounds: null },
  }))
  const configureHooks = vi.fn(async () => ({
    hookServerRunning: true,
    hookPort: 4040,
    discoveryMode: 'global' as const,
    globalDiscoveryFileExists: true,
    hookScriptInstalled: true,
    claudeSettingsHasAgentFlowHooks: true,
    lastError: null,
  }))
  const getHooksStatus = vi.fn(async () => ({
    hookServerRunning: false,
    hookPort: null,
    discoveryMode: 'global' as const,
    globalDiscoveryFileExists: false,
    hookScriptInstalled: true,
    claudeSettingsHasAgentFlowHooks: false,
    lastError: null,
  }))
  const openClaudeSettings = vi.fn(async () => {})

  const bridge: BridgeAdapter = {
    isHosted: true,
    onEvent: () => () => {},
    onStatus: () => () => {},
    onConfig: () => () => {},
    onSession: () => () => {},
    getSettings,
    updateSettings,
    configureHooks,
    getHooksStatus,
    openClaudeSettings,
    openFile: () => {},
    dispose: () => {},
  }
  return { bridge, getSettings, updateSettings, configureHooks, getHooksStatus, openClaudeSettings }
}

describe('SettingsPanel', () => {
  it('loads settings and hook status and can save/configure', async () => {
    resetBridgeForTests()
    const { bridge, updateSettings, configureHooks, getHooksStatus, openClaudeSettings } = createDesktopBridge()
    setActiveBridge(bridge)

    render(<SettingsPanel visible onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('~/.claude/projects')).toBeInTheDocument()
    })
    expect(getHooksStatus).toHaveBeenCalled()

    expect(screen.getByText('Save settings')).toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Configure hooks'))
    await waitFor(() => {
      expect(configureHooks).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByText('Open Claude settings'))
    await waitFor(() => {
      expect(openClaudeSettings).toHaveBeenCalled()
    })
  })

  it('does not render when bridge lacks desktop support', () => {
    resetBridgeForTests()
    const bridge: BridgeAdapter = {
      isHosted: true,
      onEvent: () => () => {},
      onStatus: () => () => {},
      onConfig: () => () => {},
      onSession: () => () => {},
      openFile: () => {},
      dispose: () => {},
    }
    setActiveBridge(bridge)
    const { container } = render(<SettingsPanel visible onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
