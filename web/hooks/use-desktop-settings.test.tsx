import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resetBridgeForTests, setActiveBridge, type BridgeAdapter } from '@/lib/bridge-runtime'
import { useDesktopSettings } from './use-desktop-settings'

function Harness() {
  const state = useDesktopSettings()
  return (
    <div>
      <button onClick={() => void state.refresh()}>refresh</button>
      <button onClick={() => void state.saveSettings({ claudeProjectsPath: '/tmp/custom' })}>save</button>
      <div data-testid="path">{state.settings?.claudeProjectsPath ?? 'none'}</div>
      <div data-testid="supported">{String(state.supported)}</div>
    </div>
  )
}

describe('useDesktopSettings', () => {
  it('loads and saves desktop settings through the bridge', async () => {
    resetBridgeForTests()
    const getSettings = vi.fn(async () => ({
      claudeProjectsPath: '~/.claude/projects',
      openFileStrategy: 'auto' as const,
      editorCommandTemplate: null,
      hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
      ui: { windowBounds: null },
    }))
    const updateSettings = vi.fn(async (partial) => ({
      claudeProjectsPath: partial.claudeProjectsPath ?? '~/.claude/projects',
      openFileStrategy: 'auto' as const,
      editorCommandTemplate: null,
      hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
      ui: { windowBounds: null },
    }))
    const bridge: BridgeAdapter = {
      isVSCode: true,
      onEvent: () => () => {},
      onStatus: () => () => {},
      onConfig: () => () => {},
      onSession: () => () => {},
      getSettings,
      updateSettings,
      openFile: () => {},
      dispose: () => {},
    }
    setActiveBridge(bridge)

    render(<Harness />)
    expect(screen.getByTestId('supported')).toHaveTextContent('true')

    screen.getByText('refresh').click()
    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('~/.claude/projects')
    })

    screen.getByText('save').click()
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ claudeProjectsPath: '/tmp/custom' })
      expect(screen.getByTestId('path')).toHaveTextContent('/tmp/custom')
    })
  })
})
