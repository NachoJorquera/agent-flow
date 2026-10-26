import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../shared/protocol'
import { ServiceManager } from './service-manager'
import type { DesktopSettings } from './types'

class FakeSettingsStore {
  constructor(private value: DesktopSettings) {}
  get() { return this.value }
  update(partial: Partial<DesktopSettings>) {
    this.value = {
      ...this.value,
      ...partial,
      hooks: { ...this.value.hooks, ...partial.hooks },
      ui: { ...this.value.ui, ...partial.ui },
    }
    return this.value
  }
}

class FakeSessionWatcher {
  private eventHandler: ((event: AgentEvent) => void) | null = null
  private lifecycleHandler: ((event: { type: 'started' | 'ended' | 'updated'; sessionId: string; label: string }) => void) | null = null
  onEvent = (handler: (event: AgentEvent) => void) => { this.eventHandler = handler; return { dispose() {} } }
  onSessionDetected = () => ({ dispose() {} })
  onSessionLifecycle = (handler: (event: { type: 'started' | 'ended' | 'updated'; sessionId: string; label: string }) => void) => { this.lifecycleHandler = handler; return { dispose() {} } }
  start = vi.fn()
  dispose = vi.fn()
  forceScan = vi.fn()
  getActiveSessions = vi.fn(() => [{ id: 's1', label: 'Session 1', status: 'active' as const, startTime: 1, lastActivityTime: 2 }])
  buildReplayStartEvents = vi.fn((): Array<{ sessionId: string; event: AgentEvent }> => [{ sessionId: 's1', event: { type: 'agent_spawn', time: 0, payload: { name: 'Main' } } }])
  emitEvent(event: AgentEvent) { this.eventHandler?.(event) }
  emitLifecycle(event: { type: 'started' | 'ended' | 'updated'; sessionId: string; label: string }) { this.lifecycleHandler?.(event) }
}

describe('ServiceManager handshake', () => {
  const settings: DesktopSettings = {
    claudeProjectsPath: '/tmp/claude-projects',
    openFileStrategy: 'auto',
    editorCommandTemplate: null,
    hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
    ui: { windowBounds: null },
  }

  it('buffers live events until replay completes', async () => {
    const watcher = new FakeSessionWatcher()
    const codexWatcher = new FakeSessionWatcher()
    codexWatcher.getActiveSessions.mockReturnValue([])
    codexWatcher.buildReplayStartEvents.mockReturnValue([])
    const powerSave = { update: vi.fn(), dispose: vi.fn() }
    const manager = new ServiceManager(new FakeSettingsStore(settings) as never, {
      sessionWatcher: watcher as never,
      codexSessionWatcher: codexWatcher,
      powerSave: powerSave as never,
    })
    await manager.start()

    const send = vi.fn()
    const win = { id: 1, webContents: { send }, on: vi.fn() } as never
    manager.attachWindow(win)
    manager.markSnapshotSent(win)

    watcher.emitEvent({ type: 'tool_call_start', time: 1, payload: {}, sessionId: 's1' })
    expect(send).not.toHaveBeenCalledWith('agent:event', expect.objectContaining({ type: 'tool_call_start' }))

    manager.markInitialStateApplied(win)

    expect(send).toHaveBeenCalledWith('app:beginReplay')
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ type: 'agent_spawn', sessionId: 's1' }))
    expect(send).toHaveBeenCalledWith('app:replayComplete')
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ type: 'tool_call_start', sessionId: 's1' }))

    watcher.emitEvent({ type: 'agent_idle', time: 2, payload: {}, sessionId: 's1' })
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ type: 'agent_idle', sessionId: 's1' }))
    await manager.stop()
  })

  it('combines Claude and Codex for snapshots, replay, live events, scans and power management', async () => {
    const claude = new FakeSessionWatcher()
    const codex = new FakeSessionWatcher()
    const session = { id: 'codex:s2', provider: 'codex' as const, label: 'Codex task', status: 'active' as const, startTime: 1, lastActivityTime: 2 }
    codex.getActiveSessions.mockReturnValue([session])
    codex.buildReplayStartEvents.mockReturnValue([{ sessionId: session.id, event: { type: 'agent_spawn', time: 0, payload: { name: 'Orchestrator' } } }])
    const powerSave = { update: vi.fn(), dispose: vi.fn() }
    const manager = new ServiceManager(new FakeSettingsStore(settings) as never, {
      sessionWatcher: claude as never, codexSessionWatcher: codex, powerSave: powerSave as never,
    })
    await manager.start()
    expect(manager.getInitialState().sessions.map(session => session.id)).toEqual(['s1', 'codex:s2'])
    expect(powerSave.update).toHaveBeenLastCalledWith(2)
    const send = vi.fn()
    const win = { id: 1, webContents: { send }, on: vi.fn() } as never
    manager.attachWindow(win)
    manager.markInitialStateApplied(win)
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ sessionId: 'codex:s2' }))

    codex.emitLifecycle({ type: 'started', sessionId: session.id, label: session.label })
    expect(send).toHaveBeenCalledWith('sessions:started', session)
    codex.emitEvent({ type: 'message', time: 1, sessionId: session.id, payload: { content: 'Working' } })
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ type: 'message', sessionId: session.id }))
    manager.forceImmediateScan()
    expect(claude.forceScan).toHaveBeenCalledOnce()
    expect(codex.forceScan).toHaveBeenCalledOnce()
    await manager.stop()
    expect(claude.dispose).toHaveBeenCalledOnce()
    expect(codex.dispose).toHaveBeenCalledOnce()
  })

  it('delivers buffered Codex events once when they are also in the retained replay', async () => {
    const claude = new FakeSessionWatcher()
    const codex = new FakeSessionWatcher()
    const event: AgentEvent = { type: 'message', time: 1, sessionId: 'codex:s2', payload: { agent: 'orchestrator', role: 'user', content: 'Fix it' } }
    codex.buildReplayStartEvents.mockReturnValue([{ sessionId: 'codex:s2', event }])
    const manager = new ServiceManager(new FakeSettingsStore(settings) as never, {
      sessionWatcher: claude as never, codexSessionWatcher: codex,
      powerSave: { update: vi.fn(), dispose: vi.fn() } as never,
    })
    await manager.start()
    const send = vi.fn()
    const win = { id: 1, webContents: { send }, on: vi.fn() } as never
    manager.attachWindow(win)
    codex.emitEvent(event)
    manager.markInitialStateApplied(win)
    expect(send.mock.calls.filter(([channel, value]) => channel === 'agent:event' && value.type === 'message')).toHaveLength(1)
    await manager.stop()
  })
})
