import { beforeEach, describe, expect, it, vi } from 'vitest'

const persisted = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
vi.mock('electron-store', () => ({
  default: class {
    constructor(private options: { defaults: Record<string, unknown> }) {}
    get(key: string) { return persisted.values[key] ?? this.options.defaults[key] }
    set(value: Record<string, unknown>) { persisted.values = { ...value } }
  },
}))

import { SettingsStore } from './settings-store'

describe('session view settings', () => {
  beforeEach(() => { persisted.values = {} })

  it('uses the overview for new and existing installations without a preference', () => {
    expect(new SettingsStore().get().sessionViewMode).toBe('overview')
    persisted.values = { openFileStrategy: 'cursor' }
    expect(new SettingsStore().get()).toMatchObject({ sessionViewMode: 'overview', openFileStrategy: 'cursor' })
  })

  it('keeps the selected mode across store instances and unrelated settings updates', () => {
    const store = new SettingsStore()
    store.update({ sessionViewMode: 'tabs' })
    expect(new SettingsStore().get().sessionViewMode).toBe('tabs')
    store.update({ ui: { windowBounds: { width: 1000, height: 700 } } })
    expect(new SettingsStore().get()).toMatchObject({ sessionViewMode: 'tabs', ui: { windowBounds: { width: 1000, height: 700 } } })
    store.update({ sessionViewMode: 'overview' })
    expect(new SettingsStore().get().sessionViewMode).toBe('overview')
  })
})
