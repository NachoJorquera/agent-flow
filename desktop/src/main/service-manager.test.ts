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
  buildReplayStartEvents = vi.fn(() => [{ sessionId: 's1', event: { type: 'agent_spawn', time: 0, payload: { name: 'Main' } } }])
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
    const powerSave = { update: vi.fn(), dispose: vi.fn() }
    const manager = new ServiceManager(new FakeSettingsStore(settings) as never, {
      sessionWatcher: watcher as never,
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
  })
})
