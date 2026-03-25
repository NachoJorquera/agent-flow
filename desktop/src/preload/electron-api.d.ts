export interface ElectronAPI {
  getInitialState(): Promise<unknown>
  notifyInitialStateApplied(): void
  openFile(filePath: string, line?: number): void
  writeLog(level: 'info' | 'warn' | 'error', message: string): void
  getSettings(): Promise<unknown>
  updateSettings(partial: unknown): Promise<unknown>
  configureHooks(): Promise<unknown>
  getHooksStatus(): Promise<unknown>
  openClaudeSettings(): Promise<void>
  onAgentEvent(cb: (event: unknown) => void): () => void
  onConnectionStatus(cb: (status: unknown, source: string) => void): () => void
  onSessionList(cb: (sessions: unknown[]) => void): () => void
  onSessionStarted(cb: (session: unknown) => void): () => void
  onSessionUpdated(cb: (data: { sessionId: string; label: string }) => void): () => void
  onSessionEnded(cb: (sessionId: string) => void): () => void
  onReset(cb: (reason: string) => void): () => void
  onConfig(cb: (config: unknown) => void): () => void
}
