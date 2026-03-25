import * as path from 'node:path'
import { BrowserWindow } from 'electron'
import { SettingsStore } from './settings-store'

export class WindowManager {
  constructor(private readonly settingsStore: SettingsStore) {}

  createWindow(): BrowserWindow {
    const settings = this.settingsStore.get()
    const bounds = settings.ui.windowBounds ?? { width: 1400, height: 900 }

    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      title: 'Agent Flow',
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#050510',
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) {
      void win.loadURL(rendererUrl)
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/electron-index.html'))
    }

    const persistBounds = () => {
      if (win.isDestroyed()) return
      const nextBounds = win.getBounds()
      this.settingsStore.update({ ui: { windowBounds: nextBounds } })
    }

    win.on('resize', persistBounds)
    win.on('move', persistBounds)

    return win
  }
}

