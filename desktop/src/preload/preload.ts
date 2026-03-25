import { contextBridge, ipcRenderer } from 'electron'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: T) => cb(...args)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  getInitialState: () => ipcRenderer.invoke('app:getInitialState'),
  notifyInitialStateApplied: () => ipcRenderer.send('app:initialStateApplied'),
  openFile: (filePath: string, line?: number) => ipcRenderer.send('files:open', { filePath, line }),
  writeLog: (level: 'info' | 'warn' | 'error', message: string) => ipcRenderer.send('logs:write', { level, message }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial: unknown) => ipcRenderer.invoke('settings:update', partial),
  configureHooks: () => ipcRenderer.invoke('hooks:configure'),
  getHooksStatus: () => ipcRenderer.invoke('hooks:getStatus'),
  openClaudeSettings: () => ipcRenderer.invoke('hooks:openClaudeSettings'),
  onAgentEvent: (cb: (event: unknown) => void) => subscribe('agent:event', cb),
  onConnectionStatus: (cb: (status: unknown, source: string) => void) => subscribe('connection:status', cb),
  onSessionList: (cb: (sessions: unknown[]) => void) => subscribe('sessions:list', cb),
  onSessionStarted: (cb: (session: unknown) => void) => subscribe('sessions:started', cb),
  onSessionUpdated: (cb: (data: { sessionId: string; label: string }) => void) => subscribe('sessions:updated', cb),
  onSessionEnded: (cb: (sessionId: string) => void) => subscribe('sessions:ended', cb),
  onReset: (cb: (reason: string) => void) => subscribe('app:reset', cb),
  onConfig: (cb: (config: unknown) => void) => subscribe('config:update', cb),
})

