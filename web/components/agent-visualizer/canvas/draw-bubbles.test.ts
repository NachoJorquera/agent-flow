import { describe, expect, it } from 'vitest'
import { wrapText } from './draw-bubbles'

const CHAR_W = 5

/** Monospace stand-in: every character is CHAR_W px wide */
function createContext(): CanvasRenderingContext2D {
  return {
    font: '5px test-mono',
    measureText: (text: string) => ({ width: text.length * CHAR_W }),
  } as unknown as CanvasRenderingContext2D
}

describe('wrapText', () => {
  it('wraps a line whose indentation is wider than the max width', () => {
    const lines = wrapText(createContext(), `${' '.repeat(40)}^`, 100)

    expect(lines.join('').trim()).toBe('^')
    expect(lines.every(line => line.length * CHAR_W <= 100)).toBe(true)
  })
})
