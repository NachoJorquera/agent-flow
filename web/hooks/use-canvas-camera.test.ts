import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptyContextBreakdown, type Agent } from '@/lib/agent-types'
import { useCanvasCamera } from './use-canvas-camera'

const mainAgent: Agent = {
  id: 'main', name: 'main', state: 'thinking', parentId: null,
  tokensUsed: 0, tokensMax: 200000, contextBreakdown: emptyContextBreakdown(),
  toolCalls: 0, timeAlive: 0, x: 0, y: 0, vx: 0, vy: 0,
  pinned: false, isMain: true, spawnTime: 0, opacity: 1, scale: 1, messageBubbles: [],
}

describe('useCanvasCamera', () => {
  it('zooms around the viewport center and keeps auto-fit from undoing the zoom', () => {
    const dimensions = { width: 800, height: 600 }
    const drawPropsRef = {
      current: {
        agents: new Map([[mainAgent.id, mainAgent]]), toolCalls: new Map(), discoveries: [],
        dimensions, selectedAgentId: null, isDragging: false,
      },
    }
    const { result } = renderHook(() => useCanvasCamera({
      mainCanvasRef: { current: null }, drawPropsRef, simTimeRef: { current: 0 },
      dimensions, agentCount: 1, selectedAgentId: null,
    }))
    result.current.transformRef.current = { x: 100, y: 50, scale: 1 }

    result.current.zoomBy(1.25)
    for (let frame = 0; frame < 300; frame++) result.current.updateCamera(false)

    const { x, y, scale } = result.current.transformRef.current
    expect(scale).toBeCloseTo(1.25)
    expect((400 - x) / scale).toBeCloseTo(300)
    expect((300 - y) / scale).toBeCloseTo(250)
  })
})
