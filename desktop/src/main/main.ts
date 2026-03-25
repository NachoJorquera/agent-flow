import { app, BrowserWindow, ipcMain } from 'electron'
import { installApplicationMenu } from './menu'
import { SettingsStore } from './settings-store'
import { ServiceManager } from './service-manager'
import { WindowManager } from './window-manager'
import { registerIpc } from './ipc'

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  const settingsStore = new SettingsStore()
  const serviceManager = new ServiceManager(settingsStore)
  const windowManager = new WindowManager(settingsStore)

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(async () => {
    installApplicationMenu()
    registerIpc(ipcMain, serviceManager)
    await serviceManager.start()
    const win = windowManager.createWindow()
    serviceManager.attachWindow(win)
    win.on('focus', () => serviceManager.forceImmediateScan())
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = windowManager.createWindow()
      serviceManager.attachWindow(win)
    }
    serviceManager.forceImmediateScan()
  })

  app.on('before-quit', () => {
    void serviceManager.stop()
  })
}
