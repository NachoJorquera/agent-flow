import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resetBridgeForTests, setActiveBridge, type BridgeAdapter } from '@/lib/bridge-runtime'
import { useBridge } from './use-bridge'

function HookHarness() {
  const bridge = useBridge()
  return (
    <div>
      <div data-testid="mock">{String(bridge.useMockData)}</div>
      <div data-testid="selected">{bridge.selectedSessionId ?? 'none'}</div>
      <div data-testid="activity">{Array.from(bridge.sessionsWithActivity).join(',')}</div>
    </div>
  )
}

describe('useBridge', () => {
  it('boots from electron snapshot without mock flash and notifies ready', async () => {
    resetBridgeForTests()
    const notifyInitialStateApplied = vi.fn()
    const eventListeners: Array<(event: { time: number; type: string; payload: Record<string, unknown>; sessionId?: string }) => void> = []
    const bridge: BridgeAdapter = {
      isHosted: true,
      onEvent: (cb) => { eventListeners.push(cb); return () => {} },
      onStatus: () => () => {},
      onConfig: () => () => {},
      onSession: () => () => {},
      getInitialState: async () => ({
        connectionStatus: 'watching',
        connectionSource: 'Session watcher',
        config: { mode: 'live', autoPlay: true, showMockData: false },
        desktopSettings: {
          claudeProjectsPath: '~/.claude/projects',
          openFileStrategy: 'auto',
          editorCommandTemplate: null,
          hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
          ui: { windowBounds: null },
        },
        sessions: [
          { id: 's1', label: 'Session 1', status: 'active', startTime: 1, lastActivityTime: 20 },
          { id: 's2', label: 'Session 2', status: 'completed', startTime: 1, lastActivityTime: 10 },
        ],
      }),
      notifyInitialStateApplied,
      openFile: () => {},
      dispose: () => {},
    }
    setActiveBridge(bridge)

    render(<HookHarness />)

    await waitFor(() => {
      expect(screen.getByTestId('mock')).toHaveTextContent('false')
      expect(screen.getByTestId('selected')).toHaveTextContent('s1')
    })
    expect(notifyInitialStateApplied).toHaveBeenCalled()

    eventListeners[0]?.({ type: 'tool_call', time: 1, payload: {}, sessionId: 's2' })
    await waitFor(() => {
      expect(screen.getByTestId('activity')).toHaveTextContent('s2')
    })
  })
})
