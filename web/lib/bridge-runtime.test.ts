import { describe, expect, it } from 'vitest'
import { resetBridgeForTests, getActiveBridge, setActiveBridge, type BridgeAdapter } from './bridge-runtime'

function createBridge(name: string): BridgeAdapter {
  return {
    isVSCode: true,
    onEvent: () => () => {},
    onStatus: () => () => {},
    onConfig: () => () => {},
    onSession: () => () => {},
    openFile: () => {},
    dispose: () => {},
    getInitialState: async () => null,
    notifyInitialStateApplied: () => {},
    getSettings: async () => ({ claudeProjectsPath: name, openFileStrategy: 'auto', editorCommandTemplate: null, hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false }, ui: { windowBounds: null } }),
  }
}

describe('bridge runtime', () => {
  it('returns the active bridge when set', () => {
    resetBridgeForTests()
    const bridge = createBridge('active')
    setActiveBridge(bridge)
    expect(getActiveBridge()).toBe(bridge)
  })

  it('creates a fallback bridge when window exists', () => {
    resetBridgeForTests()
    expect(getActiveBridge()).toBeTruthy()
  })
})
