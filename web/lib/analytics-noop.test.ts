import { describe, expect, it } from 'vitest'
import { Analytics } from './analytics-noop'

describe('analytics-noop', () => {
  it('exports a render-safe Analytics component', () => {
    expect(typeof Analytics).toBe('function')
    expect(Analytics()).toBeNull()
  })
})
