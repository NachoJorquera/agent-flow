import Store from 'electron-store'
import { DesktopSettings } from './types'
import { getClaudeProjectsPath } from './paths'

const defaults: DesktopSettings = {
  claudeProjectsPath: getClaudeProjectsPath(),
  openFileStrategy: 'auto',
  editorCommandTemplate: null,
  hooks: {
    enabled: false,
    lastConfiguredAt: null,
    diagnosticsDismissed: false,
  },
  ui: {
    windowBounds: { width: 1400, height: 900 },
  },
}

export class SettingsStore {
  private readonly store = new Store<DesktopSettings>({ defaults })
  private readonly conf = this.store as unknown as {
    get<K extends keyof DesktopSettings>(key: K): DesktopSettings[K]
    set(value: DesktopSettings): void
  }

  get(): DesktopSettings {
    return {
      claudeProjectsPath: this.conf.get('claudeProjectsPath'),
      openFileStrategy: this.conf.get('openFileStrategy'),
      editorCommandTemplate: this.conf.get('editorCommandTemplate'),
      hooks: this.conf.get('hooks'),
      ui: this.conf.get('ui'),
    }
  }

  update(partial: Partial<DesktopSettings>): DesktopSettings {
    const next = {
      ...this.get(),
      ...partial,
      hooks: { ...this.get().hooks, ...partial.hooks },
      ui: { ...this.get().ui, ...partial.ui },
    }
    this.conf.set(next)
    return next
  }
}
