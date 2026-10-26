import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyContextBreakdown, type Agent } from '@/lib/agent-types'
import { useCanvasCamera } from './use-canvas-camera'

const mainAgent: Agent = {
  id: 'main', name: 'main', state: 'thinking', parentId: null,
  tokensUsed: 0, tokensMax: 200000, contextBreakdown: emptyContextBreakdown(),
  toolCalls: 0, timeAlive: 0, x: 0, y: 0, vx: 0, vy: 0,
  pinned: false, isMain: true, spawnTime: 0, opacity: 1, scale: 1, messageBubbles: [],
}

function camera() {
  const dimensions = { width: 800, height: 600 }
  const drawPropsRef = {
    current: {
      agents: new Map([[mainAgent.id, { ...mainAgent }]]), toolCalls: new Map(), discoveries: [],
      dimensions, selectedAgentId: null as string | null, isDragging: false,
    },
  }
  const hook = renderHook(({ selectedAgentId }: { selectedAgentId: string | null }) => {
    drawPropsRef.current.selectedAgentId = selectedAgentId
    return useCanvasCamera({
      mainCanvasRef: { current: null }, drawPropsRef, simTimeRef: { current: 0 },
      dimensions, agentCount: drawPropsRef.current.agents.size, selectedAgentId,
    })
  }, { initialProps: { selectedAgentId: null as string | null } })
  const settle = () => {
    for (let frame = 0; frame < 300; frame++) hook.result.current.updateCamera(false)
  }
  return { ...hook, drawPropsRef, settle }
}

describe('useCanvasCamera', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('zooms around the viewport center in manual mode', () => {
    const { result, settle } = camera()
    act(() => result.current.toggleAutoFit())
    result.current.transformRef.current = { x: 100, y: 50, scale: 1 }

    result.current.zoomBy(1.25)
    settle()

    const { x, y, scale } = result.current.transformRef.current
    expect(scale).toBeCloseTo(1.25)
    expect((400 - x) / scale).toBeCloseTo(300)
    expect((300 - y) / scale).toBeCloseTo(250)
    expect(result.current.autoFitEnabled).toBe(false)
  })

  it('keeps automatic zoom enabled after manual zoom and panning, then resumes following the graph', () => {
    const { result, settle } = camera()
    settle()
    const fitted = { ...result.current.transformRef.current }

    result.current.zoomBy(0.8)
    settle()
    expect(result.current.autoFitEnabled).toBe(true)
    expect(result.current.transformRef.current.scale).toBeCloseTo(fitted.scale * 0.8)
    vi.advanceTimersByTime(700)
    settle()
    expect(result.current.transformRef.current.scale).toBeCloseTo(fitted.scale)

    result.current.onManualNavigation()
    result.current.transformRef.current.x += 400
    settle()
    expect(result.current.autoFitEnabled).toBe(true)
    expect(result.current.transformRef.current.x).toBeCloseTo(fitted.x + 400)
    vi.advanceTimersByTime(700)
    settle()
    expect(result.current.transformRef.current.x).toBeCloseTo(fitted.x)
  })

  it('fits newly added nodes and tightens the view again when they disappear', () => {
    const { result, drawPropsRef, settle } = camera()
    settle()
    const originalScale = result.current.transformRef.current.scale

    drawPropsRef.current.agents.set('distant', { ...mainAgent, id: 'distant', x: 2000 })
    settle()
    const transform = result.current.transformRef.current
    expect(transform.scale).toBeLessThan(originalScale)
    for (const agent of drawPropsRef.current.agents.values()) {
      const screenX = transform.x + agent.x * transform.scale
      expect(screenX).toBeGreaterThan(0)
      expect(screenX).toBeLessThan(800)
    }

    drawPropsRef.current.agents.delete('distant')
    settle()
    expect(result.current.transformRef.current.scale).toBeCloseTo(originalScale)
    expect(result.current.transformRef.current.x).toBeCloseTo(400)
  })

  it('keeps manual mode through graph changes, selection changes and one-shot zoom to fit', () => {
    const { result, drawPropsRef, rerender, settle } = camera()
    settle()
    act(() => result.current.toggleAutoFit())
    const frozen = { ...result.current.transformRef.current }
    drawPropsRef.current.agents.set('child', { ...mainAgent, id: 'child', parentId: 'main', isMain: false, x: 2000 })
    rerender({ selectedAgentId: 'child' })
    settle()
    expect(result.current.transformRef.current).toEqual(frozen)
    expect(result.current.autoFitEnabled).toBe(false)

    result.current.doZoomToFit()
    settle()
    expect(result.current.transformRef.current.x).not.toBe(frozen.x)
    expect(result.current.autoFitEnabled).toBe(false)

    act(() => result.current.toggleAutoFit())
    expect(result.current.autoFitEnabled).toBe(true)
    drawPropsRef.current.agents.delete('child')
    rerender({ selectedAgentId: null })
    settle()
    expect(result.current.transformRef.current.x).toBeCloseTo(frozen.x)
  })

  it('freezes an in-progress automatic fit when explicitly disabled', () => {
    const { result, drawPropsRef, settle } = camera()
    drawPropsRef.current.agents.set('distant', { ...mainAgent, id: 'distant', x: 2000 })
    result.current.updateCamera(false)
    act(() => result.current.toggleAutoFit())
    const frozen = { ...result.current.transformRef.current }
    settle()
    expect(result.current.transformRef.current).toEqual(frozen)
  })
})
