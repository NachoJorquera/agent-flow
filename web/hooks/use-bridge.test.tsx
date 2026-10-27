import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resetBridgeForTests, setActiveBridge, type BridgeAdapter, type EventCallback, type SessionCallback, type DesktopSettings } from '@/lib/bridge-runtime'
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
  it('defaults to all sessions and rebuilds only the chosen mode when settings change', () => {
    resetBridgeForTests()
    let onEvent: EventCallback = () => {}
    let onSession: SessionCallback = () => {}
    let onSettings: (settings: DesktopSettings) => void = () => {}
    const settings: DesktopSettings = {
      sessionViewMode: 'overview',
      claudeProjectsPath: '~/.claude/projects',
      openFileStrategy: 'auto', editorCommandTemplate: null,
      hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
      ui: { windowBounds: null },
    }
    setActiveBridge({
      isHosted: true,
      onEvent: cb => { onEvent = cb; return () => {} },
      onSession: cb => { onSession = cb; return () => {} },
      onSettings: cb => { onSettings = cb; return () => {} },
      onStatus: () => () => {}, onConfig: () => () => {}, openFile: () => {}, dispose: () => {},
    })
    const { result } = renderHook(() => useBridge())
    expect(result.current.sessionViewMode).toBe('overview')

    act(() => {
      onSession('list', [
        { id: 's1', label: 'One', status: 'active', startTime: 0, lastActivityTime: 2 },
        { id: 's2', label: 'Two', status: 'active', startTime: 0, lastActivityTime: 1 },
      ])
      onEvent({ sessionId: 's1', type: 'agent_spawn', time: 0, payload: { name: 'main' } })
      onEvent({ sessionId: 's2', type: 'agent_spawn', time: 0, payload: { name: 'main' } })
    })
    expect(result.current.pendingEvents.map(event => event.sessionId)).toEqual(['s1', 's2'])
    expect(result.current.pendingEvents.map(event => event.payload.name)).toEqual(['["s1","main"]', '["s2","main"]'])
    expect(result.current.sessionsWithActivity.size).toBe(0)

    act(() => { result.current.consumeEvents(); onSettings({ ...settings, sessionViewMode: 'tabs' }) })
    expect(result.current.sessionViewMode).toBe('tabs')
    expect(result.current.pendingEvents).toHaveLength(1)
    expect(result.current.pendingEvents[0]?.payload.name).toBe('main')
    act(() => result.current.consumeEvents())
    act(() => onEvent({ sessionId: 's2', type: 'message', time: 1, payload: { agent: 'main', content: 'Background work' } }))
    expect(result.current.pendingEvents).toHaveLength(0)
    expect(result.current.sessionsWithActivity.has('s2')).toBe(true)

    act(() => result.current.selectSession('s2'))
    expect(result.current.pendingEvents).toHaveLength(2)
    expect(result.current.pendingEvents.every(event => event.sessionId === 's2')).toBe(true)
    expect(result.current.pendingEvents.find(event => event.type === 'message')?.historical).toBe(true)
    act(() => { result.current.consumeEvents(); onSettings(settings) })
    expect(result.current.sessionViewMode).toBe('overview')
    expect(result.current.pendingEvents).toHaveLength(3)
    expect(result.current.sessionsWithActivity.size).toBe(0)
    act(() => onSession('started', { id: 's3', label: 'Three', status: 'active', startTime: 2, lastActivityTime: 2 }))
    expect(result.current.sessionViewMode).toBe('overview')
    expect(result.current.pendingEvents).toHaveLength(3)

    act(() => onSettings({ ...settings, sessionViewMode: 'tabs' }))
    act(() => result.current.removeSession('s1'))
    act(() => onSettings(settings))
    expect(result.current.pendingEvents).toHaveLength(2)
    expect(result.current.pendingEvents.every(event => event.sessionId === 's2')).toBe(true)

    act(() => result.current.consumeEvents())
    act(() => onEvent({ sessionId: 's1', type: 'message', time: 2, payload: { agent: 'main', content: 'Resumed work' } }))
    expect(result.current.sessions.some(session => session.id === 's1')).toBe(true)
    expect(result.current.pendingEvents.map(event => event.type)).toEqual(['agent_spawn', 'message'])
    expect(result.current.pendingEvents.every(event => event.sessionId === 's1')).toBe(true)
    act(() => result.current.consumeEvents())
    act(() => onEvent({ sessionId: 's1', type: 'message', time: 3, payload: { agent: 'main', content: 'More work' } }))
    expect(result.current.pendingEvents).toHaveLength(1)
    expect(result.current.pendingEvents[0].historical).toBeUndefined()

    act(() => onSession('reset', 'reopened'))
    expect(result.current.sessionResetVersion).toBe(1)
    expect(result.current.pendingEvents).toHaveLength(0)
    act(() => onSettings({ ...settings, sessionViewMode: 'tabs' }))
    expect(result.current.pendingEvents).toHaveLength(0)
  })

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
          sessionViewMode: 'tabs',
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

  it.each(['overview', 'tabs'] as const)('merges a late-discovered reviewer without losing its history in %s mode', mode => {
    resetBridgeForTests()
    let onEvent: EventCallback = () => {}
    let onSession: SessionCallback = () => {}
    let onSettings: (settings: DesktopSettings) => void = () => {}
    setActiveBridge({
      isHosted: true, onEvent: cb => { onEvent = cb; return () => {} },
      onSession: cb => { onSession = cb; return () => {} },
      onSettings: cb => { onSettings = cb; return () => {} },
      onStatus: () => () => {}, onConfig: () => () => {}, openFile() {}, dispose() {},
    })
    const { result } = renderHook(() => useBridge())
    act(() => {
      onSession('list', [
        { id: 'parent', label: 'Claude', status: 'active', startTime: 0, lastActivityTime: 1 },
        { id: 'codex:child', label: 'Sol review', status: 'active', startTime: 1, lastActivityTime: 2 },
      ])
      onEvent({ type: 'agent_spawn', time: 0, sessionId: 'parent', payload: { name: 'orchestrator', isMain: true } })
      onEvent({ type: 'agent_spawn', time: 1, sessionId: 'parent', payload: { name: 'reviewer', parent: 'orchestrator' } })
      onEvent({ type: 'agent_spawn', time: 0, sessionId: 'codex:child', payload: { name: 'orchestrator', isMain: true } })
      onEvent({ type: 'message', time: 2, sessionId: 'codex:child', payload: { agent: 'orchestrator', content: 'Review in progress' } })
    })
    act(() => {
      result.current.selectSession('codex:child')
      onSettings({ sessionViewMode: mode } as DesktopSettings)
      result.current.consumeEvents()
      onSession('merged', { sessionId: 'codex:child', parentSessionId: 'parent', events: [
        { type: 'message', time: 3, sessionId: 'parent', payload: { agent: 'reviewer', content: 'Review in progress' } },
      ] })
    })
    expect(result.current.sessions.map(session => session.id)).toEqual(['parent'])
    expect(result.current.selectedSessionId).toBe('parent')
    expect(result.current.getSessionEventCount('codex:child')).toBe(0)
    expect(result.current.getSessionEventCount('parent')).toBe(3)
    expect(result.current.sessionResetVersion).toBe(1)
    expect(result.current.pendingEvents).toHaveLength(3)
    expect(result.current.pendingEvents.every(event => event.sessionId === 'parent')).toBe(true)
    expect(result.current.pendingEvents.at(-1)?.payload.agent).toBe(mode === 'overview' ? '["parent","reviewer"]' : 'reviewer')
  })
})
