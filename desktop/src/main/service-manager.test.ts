import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SessionInfo } from '../shared/protocol'
import { ServiceManager } from './service-manager'
import type { DesktopSettings } from './types'
import { TypedEventEmitter } from '../shared/event-emitter'

function fakeSessionTitles() {
  const titles = new Map<string, string>()
  const sessions = new Map<string, string>()
  const changes = new TypedEventEmitter<string[]>()
  return {
    get: (sessionId: string) => titles.get(sessionId),
    getSessionId: (threadId: string) => sessions.get(threadId),
    start: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    dispose: vi.fn(),
    onChange: changes.event,
    set(sessionId: string, title: string) {
      titles.set(sessionId, title)
      changes.fire([sessionId])
    },
    link(threadId: string, sessionId: string) {
      sessions.set(threadId, sessionId)
      changes.fire([sessionId])
    },
  }
}

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
  getActiveSessions = vi.fn((): SessionInfo[] => [{ id: 's1', label: 'Session 1', status: 'active', startTime: 1, lastActivityTime: 2 }])
  buildReplayStartEvents = vi.fn((): Array<{ sessionId: string; event: AgentEvent }> => [{ sessionId: 's1', event: { type: 'agent_spawn', time: 0, payload: { name: 'Main' } } }])
  emitEvent(event: AgentEvent) { this.eventHandler?.(event) }
  emitLifecycle(event: { type: 'started' | 'ended' | 'updated'; sessionId: string; label: string }) { this.lifecycleHandler?.(event) }
}

describe('ServiceManager handshake', () => {
  const settings: DesktopSettings = {
    sessionViewMode: 'overview',
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
      sessionTitles: fakeSessionTitles(),
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
    const updatedSettings = manager.updateSettings({ sessionViewMode: 'tabs' })
    expect(updatedSettings.sessionViewMode).toBe('tabs')
    expect(send).toHaveBeenCalledWith('settings:updated', updatedSettings)
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
      sessionTitles: fakeSessionTitles(),
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
      sessionTitles: fakeSessionTitles(),
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

  it('prefers real T3 titles over prompt labels for both providers and updates them without another turn', async () => {
    const claude = new FakeSessionWatcher()
    const codex = new FakeSessionWatcher()
    const session = { id: 'codex:s2', provider: 'codex' as const, label: '[Image: Screenshot.png; ref=image_123] First prompt', status: 'active' as const, startTime: 1, lastActivityTime: 2 }
    codex.getActiveSessions.mockReturnValue([session])
    const titles = fakeSessionTitles()
    titles.set('s1', 'Sincronizar repositorios')
    titles.set(session.id, 'Corregir títulos y ancho de nodos')
    const manager = new ServiceManager(new FakeSettingsStore(settings) as never, {
      sessionWatcher: claude as never, codexSessionWatcher: codex, sessionTitles: titles,
      powerSave: { update: vi.fn(), dispose: vi.fn() } as never,
    })
    await manager.start()
    expect(manager.getInitialState().sessions.map(session => session.label)).toEqual(['Sincronizar repositorios', 'Corregir títulos y ancho de nodos'])
    const send = vi.fn()
    const win = { id: 1, webContents: { send }, on: vi.fn() } as never
    manager.attachWindow(win)
    manager.markInitialStateApplied(win)

    codex.emitLifecycle({ type: 'started', sessionId: session.id, label: session.label })
    expect(send).toHaveBeenCalledWith('sessions:started', { ...session, label: 'Corregir títulos y ancho de nodos' })
    codex.emitLifecycle({ type: 'updated', sessionId: session.id, label: 'Provisional prompt label' })
    expect(send).toHaveBeenLastCalledWith('sessions:updated', { sessionId: session.id, label: 'Corregir títulos y ancho de nodos' })

    titles.set(session.id, 'Nuevo título real')
    expect(send).toHaveBeenLastCalledWith('sessions:updated', { sessionId: session.id, label: 'Nuevo título real' })
    expect(manager.getInitialState().sessions[1].label).toBe('Nuevo título real')
    await manager.stop()
    expect(titles.dispose).toHaveBeenCalledOnce()
  })

  it.each([false, true])('joins a delegated Codex rollout to Claude (metadata arrives late: %s)', async late => {
    const claude = new FakeSessionWatcher()
    const codex = new FakeSessionWatcher()
    const child = { id: 'codex:review', provider: 'codex' as const, label: 'Sol review', status: 'active' as const, startTime: 1000, lastActivityTime: 2000 }
    codex.getActiveSessions.mockReturnValue([child])
    const root: AgentEvent = { type: 'agent_spawn', time: 0, payload: { name: 'orchestrator', isMain: true, provider: 'codex' } }
    const tool: AgentEvent = { type: 'tool_call_start', time: 2, payload: { agent: 'orchestrator', tool: 'exec', args: 'npm test' } }
    codex.buildReplayStartEvents.mockReturnValue([root, tool].map(event => ({ sessionId: child.id, event })))
    const titles = fakeSessionTitles()
    if (!late) titles.link('child-thread', child.id)
    const manager = new ServiceManager(new FakeSettingsStore(settings) as never, {
      sessionWatcher: claude as never, codexSessionWatcher: codex, sessionTitles: titles,
      powerSave: { update: vi.fn(), dispose: vi.fn() } as never,
    })
    await manager.start()
    const send = vi.fn()
    const win = { id: 1, webContents: { send }, on: vi.fn() } as never
    manager.attachWindow(win)
    manager.markInitialStateApplied(win)
    claude.emitEvent({ type: 'agent_spawn', time: 0, sessionId: 's1', payload: { name: 'Sol reviewer', parent: 'orchestrator', provider: 'codex' } })
    claude.emitEvent({ type: 'agent_link', time: 0, sessionId: 's1', payload: { name: 'Sol reviewer', parent: 'orchestrator', childThreadId: 'child-thread' } })
    if (late) titles.link('child-thread', child.id)

    expect(manager.getInitialState().sessions.map(session => session.id)).toEqual(['s1'])
    expect(send).toHaveBeenCalledWith('sessions:merged', expect.objectContaining({
      sessionId: child.id, parentSessionId: 's1', events: expect.arrayContaining([
        expect.objectContaining({ sessionId: 's1', type: 'tool_call_start', payload: expect.objectContaining({ agent: 'Sol reviewer' }) }),
      ]),
    }))
    send.mockClear()
    const secondWindowSend = vi.fn()
    const secondWindow = { id: 2, webContents: { send: secondWindowSend }, on: vi.fn() } as never
    manager.attachWindow(secondWindow)
    codex.emitEvent({ ...tool, sessionId: child.id })
    manager.markInitialStateApplied(secondWindow)
    expect(secondWindowSend.mock.calls.filter(([channel, event]) => channel === 'agent:event' && event.type === 'tool_call_start')).toHaveLength(1)
    codex.emitEvent({ type: 'context_update', time: 3, sessionId: child.id, payload: { agent: 'orchestrator', tokens: 68000 } })
    claude.getActiveSessions.mockReturnValue([{ id: 's1', label: 'Claude parent', status: 'completed', startTime: 1, lastActivityTime: 2 }])
    claude.emitEvent({ type: 'agent_complete', time: 3, sessionId: 's1', payload: { name: 'orchestrator' } })
    claude.emitLifecycle({ type: 'ended', sessionId: 's1', label: 'Claude parent' })
    expect(manager.getInitialState().sessions[0].status).toBe('active')
    expect(send).not.toHaveBeenCalledWith('agent:event', expect.objectContaining({ type: 'agent_complete', payload: { name: 'orchestrator' } }))
    codex.getActiveSessions.mockReturnValue([{ ...child, status: 'completed' }])
    codex.emitEvent({ type: 'agent_idle', time: 4, sessionId: child.id, payload: { name: 'orchestrator', turnComplete: true } })
    codex.emitLifecycle({ type: 'ended', sessionId: child.id, label: child.label })
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ sessionId: 's1', type: 'context_update', payload: { agent: 'Sol reviewer', tokens: 68000 } }))
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ sessionId: 's1', type: 'agent_complete', payload: expect.objectContaining({ name: 'Sol reviewer' }) }))
    expect(send.mock.calls.every(([channel, data]) => channel !== 'agent:event' || data.sessionId === 's1')).toBe(true)
    expect(send).not.toHaveBeenCalledWith('sessions:ended', child.id)
    expect(send).toHaveBeenCalledWith('sessions:ended', 's1')
    expect(manager.getInitialState().sessions[0].status).toBe('completed')

    send.mockClear()
    manager.markInitialStateApplied(win)
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ sessionId: 's1', type: 'agent_spawn', payload: expect.objectContaining({ name: 'Sol reviewer', isMain: false, parent: 'orchestrator' }) }))
    expect(send.mock.calls.every(([channel, data]) => channel !== 'agent:event' || data.sessionId === 's1')).toBe(true)
    await manager.stop()
  })
})
