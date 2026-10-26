import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, SimulationEvent } from '@/lib/agent-types'
import {
  resetBridgeForTests, setActiveBridge,
  type DesktopSettings, type EventCallback, type SessionCallback,
} from '@/lib/bridge-runtime'
import { AgentVisualizer } from './index'

// Keep the real bridge, simulation, and UI; replace browser-only drawing/audio.
vi.mock('./canvas', () => ({
  AgentCanvas: ({ agents, currentTime }: { agents: Map<string, Agent>; currentTime: number }) => (
    <output data-testid="graph">{JSON.stringify({ agents: [...agents.values()], currentTime })}</output>
  ),
}))

vi.mock('@/lib/audio-engine', () => ({
  AudioEngine: class {
    setMuted() {}
    dispose() {}
    playAgentSpawn() {}
    playAgentComplete() {}
    playToolStart() {}
    playToolEnd() {}
    playError() {}
  },
}))

const settings: DesktopSettings = {
  sessionViewMode: 'overview', claudeProjectsPath: '~/.claude/projects',
  openFileStrategy: 'auto', editorCommandTemplate: null,
  hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
  ui: { windowBounds: null },
}

function connectBridge() {
  let event: EventCallback = () => {}
  let session: SessionCallback = () => {}
  let changeSettings: (settings: DesktopSettings) => void = () => {}
  setActiveBridge({
    isHosted: true,
    onEvent: cb => { event = cb; return () => {} },
    onSession: cb => { session = cb; return () => {} },
    onSettings: cb => { changeSettings = cb; return () => {} },
    onStatus: () => () => {}, onConfig: () => () => {},
    openFile: () => {}, dispose: () => {},
  })
  return {
    emit: (sessionId: string, type: SimulationEvent['type'], payload: Record<string, unknown>, time = 0) => {
      act(() => event({ sessionId, time, type, payload }))
    },
    listSessions: () => act(() => session('list', [
      { id: 's1', label: 'One', status: 'active', startTime: 0, lastActivityTime: 2 },
      { id: 's2', label: 'Two', status: 'active', startTime: 0, lastActivityTime: 1 },
    ])),
    setMode: (sessionViewMode: DesktopSettings['sessionViewMode']) => act(() => changeSettings({ ...settings, sessionViewMode })),
    reset: () => act(() => session('reset', 'reopened')),
  }
}

function graph(): { agents: Agent[]; currentTime: number } {
  return JSON.parse(screen.getByTestId('graph').textContent!)
}

describe('session view integration', () => {
  let frames: Map<number, FrameRequestCallback>
  let frameId: number
  let timestamp: number
  let scrollIntoView: PropertyDescriptor | undefined

  beforeEach(() => {
    resetBridgeForTests()
    vi.useFakeTimers()
    frames = new Map()
    frameId = 0
    timestamp = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    expect(frames.size).toBe(0)
    resetBridgeForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  function nextFrame() {
    timestamp += 16
    const callbacks = [...frames.values()]
    frames.clear()
    act(() => callbacks.forEach(callback => callback(timestamp)))
    act(() => vi.advanceTimersByTime(1))
  }

  function startPlayback() {
    act(() => vi.advanceTimersByTime(501))
    nextFrame()
  }

  it('keeps a single simulation loop while repeatedly switching modes, resetting and unmounting', () => {
    const bridge = connectBridge()
    render(<AgentVisualizer />)
    bridge.listSessions()
    for (const id of ['s1', 's2']) {
      bridge.emit(id, 'agent_spawn', { name: 'orchestrator', isMain: true })
      bridge.emit(id, 'agent_spawn', { name: 'researcher', parent: 'orchestrator' })
    }
    startPlayback()
    expect(graph().agents).toHaveLength(4)
    expect(frames.size).toBe(1)

    for (let round = 0; round < 3; round++) {
      bridge.setMode('tabs')
      startPlayback()
      expect(graph().agents.map(agent => agent.id).sort()).toEqual(['orchestrator', 'researcher'])
      expect(frames.size).toBe(1)
      bridge.setMode('overview')
      startPlayback()
      expect(graph().agents).toHaveLength(4)
      expect(new Set(graph().agents.map(agent => agent.id)).size).toBe(4)
      expect(frames.size).toBe(1)
    }

    bridge.reset()
    startPlayback()
    expect(graph().agents).toHaveLength(0)
    expect(frames.size).toBe(1)
  })

  it('keeps the common timeline monotonic when sessions use different elapsed clocks', () => {
    const bridge = connectBridge()
    render(<AgentVisualizer />)
    bridge.listSessions()
    bridge.emit('s1', 'agent_spawn', { name: 'orchestrator', isMain: true }, 900)
    bridge.emit('s1', 'tool_call_start', { agent: 'orchestrator', tool: 'Read', args: 'README.md' }, 901)
    bridge.emit('s2', 'agent_spawn', { name: 'orchestrator', isMain: true }, 0)
    bridge.emit('s2', 'message', { agent: 'orchestrator', role: 'assistant', content: 'Starting' }, 1)
    startPlayback()
    expect(graph().currentTime).toBeGreaterThanOrEqual(901)
    for (const agent of graph().agents) expect(agent.spawnTime).toBeLessThanOrEqual(graph().currentTime)
    bridge.emit('s2', 'message', { agent: 'orchestrator', role: 'assistant', content: 'Working' }, 2)
    nextFrame()
    expect(graph().currentTime).toBeGreaterThanOrEqual(901)
  })
})
