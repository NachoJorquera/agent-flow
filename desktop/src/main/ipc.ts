import { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { ServiceManager } from './service-manager'

function getWindowFromEvent(event: IpcMainInvokeEvent | Electron.IpcMainEvent): BrowserWindow | null {
  const sender = 'sender' in event ? event.sender : null
  return sender ? BrowserWindow.fromWebContents(sender as WebContents) : null
}

export function registerIpc(ipcMain: IpcMain, serviceManager: ServiceManager): void {
  ipcMain.handle('app:getInitialState', (event) => {
    const win = getWindowFromEvent(event)
    if (win) serviceManager.markSnapshotSent(win)
    return serviceManager.getInitialState()
  })

  ipcMain.on('app:initialStateApplied', (event) => {
    const win = getWindowFromEvent(event)
    if (win) serviceManager.markInitialStateApplied(win)
  })

  ipcMain.on('files:open', (_event, payload: { filePath: string; line?: number }) => {
    void serviceManager.openFile(payload.filePath, payload.line)
  })

  ipcMain.on('logs:write', (_event, payload: { level: string; message: string }) => {
    const logFn = payload.level === 'error' ? console.error : payload.level === 'warn' ? console.warn : console.log
    logFn(`[Renderer/${payload.level}]`, payload.message)
  })

  ipcMain.handle('settings:get', () => serviceManager.getSettings())
  ipcMain.handle('settings:update', (_event, partial) => serviceManager.updateSettings(partial))
  ipcMain.handle('hooks:configure', () => serviceManager.configureHooks())
  ipcMain.handle('hooks:getStatus', () => serviceManager.getHooksStatus())
  ipcMain.handle('hooks:openClaudeSettings', () => serviceManager.openClaudeSettings())
}

