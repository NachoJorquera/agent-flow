import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionWatcher } from './session-watcher'

class TestSessionWatcher extends SessionWatcher {
  public watchCalls: string[] = []
  public existingPaths = new Set<string>()
  public throwOnWatch = false

  protected override pathExists(targetPath: string): boolean {
    return this.existingPaths.has(targetPath)
  }

  protected override watchPath(targetPath: string, listener: (eventType: string, filename: string | Buffer | null) => void) {
    this.watchCalls.push(targetPath)
    if (this.throwOnWatch) {
      throw new Error('watch failed')
    }
    return { close: vi.fn(), listener } as unknown as import('node:fs').FSWatcher
  }
}

describe('SessionWatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses configurable claudeDir for global root watch', () => {
    const tempDir = path.join(os.tmpdir(), 'agent-flow-watcher-root')
    const intervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue({} as NodeJS.Timeout)

    const watcher = new TestSessionWatcher({ claudeDir: tempDir, enableGlobalRootWatch: true })
    watcher.existingPaths.add(tempDir)
    watcher.start()

    expect(watcher.watchCalls).toContain(tempDir)
    expect(intervalSpy).toHaveBeenCalled()

    watcher.dispose()
  })

  it('continues when root watch setup fails', () => {
    const tempDir = path.join(os.tmpdir(), 'agent-flow-watcher-root')
    const intervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue({} as NodeJS.Timeout)

    const watcher = new TestSessionWatcher({ claudeDir: tempDir, enableGlobalRootWatch: true })
    watcher.existingPaths.add(tempDir)
    watcher.throwOnWatch = true

    expect(() => watcher.start()).not.toThrow()
    expect(intervalSpy).toHaveBeenCalled()
    watcher.dispose()
  })

  it('forceScan triggers scanForActiveSessions', () => {
    const watcher = new TestSessionWatcher({ enableGlobalRootWatch: false })
    const scanSpy = vi.spyOn(watcher as unknown as { scanForActiveSessions: () => void }, 'scanForActiveSessions')
    watcher.forceScan()
    expect(scanSpy).toHaveBeenCalled()
    watcher.dispose()
  })

  it('does not load a recent transcript whose Claude Code process already exited', () => {
    const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-watcher-scan-'))
    const projectDir = path.join(claudeDir, '-Users-dev-project')
    fs.mkdirSync(projectDir)
    const userLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Revisa el PR' } })
    fs.writeFileSync(path.join(projectDir, 'live-session.jsonl'), `${userLine}\n`)
    fs.writeFileSync(path.join(projectDir, 'closed-session.jsonl'), `${userLine}\n${JSON.stringify({ type: 'cost-state' })}\n`)

    const watcher = new SessionWatcher({ claudeDir, enableGlobalRootWatch: false })
    watcher.forceScan()

    expect(watcher.getActiveSessions().map(session => session.id)).toEqual(['live-session'])
    watcher.dispose()
    fs.rmSync(claudeDir, { recursive: true, force: true })
  })
})
