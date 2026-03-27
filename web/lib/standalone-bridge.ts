import type { BridgeAdapter, EventCallback, StatusCallback, ConfigCallback, SessionCallback } from './bridge-runtime'

/**
 * Standalone bridge for the web dev/demo harness.
 * No host backend is connected — the app runs with mock data.
 */
export class StandaloneBridge implements BridgeAdapter {
  get isHosted(): boolean {
    return false
  }

  onEvent(_cb: EventCallback): () => void { return () => {} }
  onStatus(_cb: StatusCallback): () => void { return () => {} }
  onConfig(_cb: ConfigCallback): () => void { return () => {} }
  onSession(_cb: SessionCallback): () => void { return () => {} }

  openFile(): void { /* noop — no host to open files */ }

  dispose(): void { /* nothing to clean up */ }
}
