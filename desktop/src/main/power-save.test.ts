import { describe, expect, it, vi } from 'vitest'

const powerSaveMock = vi.hoisted(() => ({
  start: vi.fn(() => 42),
  stop: vi.fn(),
  isStarted: vi.fn(() => true),
}))

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: powerSaveMock.start,
    stop: powerSaveMock.stop,
    isStarted: powerSaveMock.isStarted,
  },
}))

import { PowerSaveManager } from './power-save'

describe('PowerSaveManager', () => {
  it('starts blocker when sessions become active', () => {
    const manager = new PowerSaveManager()
    manager.update(1)
    expect(powerSaveMock.start).toHaveBeenCalledWith('prevent-app-suspension')
  })

  it('does not start twice while already active', () => {
    const manager = new PowerSaveManager()
    manager.update(1)
    manager.update(2)
    expect(powerSaveMock.start).toHaveBeenCalledTimes(1)
  })

  it('stops blocker when sessions return to zero', () => {
    const manager = new PowerSaveManager()
    manager.update(1)
    manager.update(0)
    expect(powerSaveMock.stop).toHaveBeenCalledWith(42)
  })

  it('dispose releases blocker', () => {
    const manager = new PowerSaveManager()
    manager.update(1)
    manager.dispose()
    expect(powerSaveMock.stop).toHaveBeenCalledWith(42)
  })
})
