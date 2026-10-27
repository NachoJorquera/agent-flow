import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SCAN_INTERVAL_MS } from './constants'
import { TypedEventEmitter, type Disposable } from './event-emitter'
import { createLogger } from './logger'

const log = createLogger('T3SessionTitles')
const LEGACY_TITLES_SQL = `
  SELECT s.provider_name AS provider, s.provider_thread_id AS native_id, t.title, t.thread_id
  FROM projection_thread_sessions s JOIN projection_threads t ON t.thread_id = s.thread_id
  WHERE t.deleted_at IS NULL`
const TITLES_SQL = `${LEGACY_TITLES_SQL} UNION ALL
  SELECT p.driver AS provider, json_extract(p.payload_json, '$.nativeThreadRef.nativeId') AS native_id, t.title, t.thread_id
  FROM orchestration_v2_projection_provider_threads p
  JOIN orchestration_v2_projection_threads t ON t.thread_id = p.thread_id
  WHERE p.owner_node_id IS NULL AND t.deleted_at IS NULL`

function queryTitles(database: string, sql: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(process.platform === 'darwin' ? '/usr/bin/sqlite3' : 'sqlite3', ['-readonly', '-json', database, sql], {
      timeout: 2000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    }, (error, stdout) => {
      if (error) return reject(error)
      try { resolve(stdout.trim() ? JSON.parse(stdout) : []) } catch (error) { reject(error) }
    })
  })
}

/** T3 names live outside provider transcripts. Read its local projections without modifying them. */
export class T3SessionTitles implements Disposable {
  private readonly dataDir: string
  private titles = new Map<string, string>()
  private threadSessions = new Map<string, string>()
  private fingerprint = ''
  private timer: NodeJS.Timeout | null = null
  private pending: Promise<void> | null = null
  private disposed = false
  private readonly changes = new TypedEventEmitter<string[]>()
  readonly onChange = this.changes.event

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir ?? path.join(os.homedir(), '.t3', 'userdata')
  }

  get(sessionId: string): string | undefined {
    return this.titles.get(sessionId)
  }

  getSessionId(threadId: string): string | undefined {
    return this.threadSessions.get(threadId)
  }

  async start(): Promise<void> {
    await this.refresh()
    if (!this.disposed && !this.timer) this.timer = setInterval(() => { void this.refresh() }, SCAN_INTERVAL_MS)
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (!this.pending) this.pending = this.load().finally(() => { this.pending = null })
    return this.pending
  }

  private async load(): Promise<void> {
    try {
      const database = ['statev2.sqlite', 'state.sqlite'].map(file => path.join(this.dataDir, file)).find(file => fs.existsSync(file))
      if (!database) return
      // SQLite commonly appends title changes to the WAL before touching the database file.
      const fingerprint = [database, `${database}-wal`].map(file => {
        try {
          const stat = fs.statSync(file)
          return `${file}:${stat.size}:${stat.mtimeMs}`
        } catch { return file }
      }).join('|')
      if (fingerprint === this.fingerprint) return
      let rows: unknown
      try { rows = await queryTitles(database, TITLES_SQL) }
      catch { rows = await queryTitles(database, LEGACY_TITLES_SQL) }
      if (this.disposed || !Array.isArray(rows)) return
      const titles = new Map<string, string>()
      const threadSessions = new Map<string, string>()
      for (const row of rows) {
        if (!row || typeof row.native_id !== 'string' || !row.native_id || typeof row.title !== 'string' || !row.title.trim()) continue
        const sessionId = row.provider === 'codex' ? `codex:${row.native_id}`
          : row.provider === 'claudeAgent' || row.provider === 'claude' ? row.native_id : undefined
        if (sessionId) {
          titles.set(sessionId, row.title.trim())
          if (typeof row.thread_id === 'string') threadSessions.set(row.thread_id, sessionId)
        }
      }
      const changed = [...new Set([...this.titles.keys(), ...titles.keys()])].filter(id => this.titles.get(id) !== titles.get(id))
      for (const [threadId, sessionId] of threadSessions) {
        if (this.threadSessions.get(threadId) !== sessionId && !changed.includes(sessionId)) changed.push(sessionId)
      }
      this.titles = titles
      this.threadSessions = threadSessions
      this.fingerprint = fingerprint
      if (changed.length) this.changes.fire(changed)
    } catch (error) { log.debug('Cannot read T3 session titles:', error) }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.changes.dispose()
  }
}
