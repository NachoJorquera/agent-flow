import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'

type Titles = Map<string, string>

/** Read the saved names outside rollouts, where T3 and Codex keep session titles. */
export class CodexSessionTitles {
  private readonly cache = new Map<string, { fingerprint: string; titles: Titles }>()
  private sources: Titles[] = []

  constructor(private readonly codexHome: string, private readonly t3DataDir: string) {}

  refresh(): void {
    let databases: string[] = []
    try {
      databases = fs.readdirSync(this.codexHome).filter(name => /^state_\d+\.sqlite$/.test(name))
        .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))
    } catch { /* Codex may not have created its metadata directory yet. */ }

    this.sources = [
      this.readDatabase(path.join(this.t3DataDir, 'statev2.sqlite'), [
        `SELECT json_extract(p.payload_json, '$.nativeThreadRef.nativeId') AS id, t.title
         FROM orchestration_v2_projection_provider_threads p
         JOIN orchestration_v2_projection_threads t ON t.thread_id = p.thread_id
         WHERE p.provider = 'codex' AND t.deleted_at IS NULL`,
      ]),
      this.readDatabase(path.join(this.t3DataDir, 'state.sqlite'), [
        `SELECT s.provider_thread_id AS id, t.title
         FROM projection_thread_sessions s JOIN projection_threads t ON t.thread_id = s.thread_id
         WHERE s.provider_name = 'codex' AND t.deleted_at IS NULL`,
      ]),
      this.readSource(path.join(this.codexHome, 'session_index.jsonl'), file => {
        const titles: Titles = new Map()
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          try {
            const entry = JSON.parse(line)
            if (typeof entry.id === 'string' && typeof entry.thread_name === 'string' && entry.thread_name.trim()) {
              titles.set(entry.id, entry.thread_name.trim())
            }
          } catch { /* An append may leave an incomplete last line. */ }
        }
        return titles
      }),
      ...databases.slice(0, 1).map(file => this.readDatabase(path.join(this.codexHome, file), [
        "SELECT id, COALESCE(NULLIF(name, ''), title) AS title FROM threads",
        'SELECT id, title FROM threads',
      ])),
    ]
  }

  get(sessionId: string): string | undefined {
    for (const source of this.sources) {
      const title = source.get(sessionId)
      if (title) return title
    }
    return undefined
  }

  private readDatabase(file: string, queries: string[]): Titles {
    return this.readSource(file, () => {
      for (const query of queries) {
        try {
          // macOS includes sqlite3. No shell, write access, or native Node addon is needed.
          const output = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', file, query], {
            encoding: 'utf8', timeout: 1000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
          })
          const rows: Array<{ id?: unknown; title?: unknown }> = JSON.parse(output || '[]')
          return new Map(rows.flatMap(row => typeof row.id === 'string' && typeof row.title === 'string' && row.title.trim()
            ? [[row.id, row.title.trim()] as [string, string]] : []))
        } catch { /* Try the older schema, or keep the last successfully read names. */ }
      }
      throw new Error('Session title metadata is unavailable')
    }, true)
  }

  private readSource(file: string, read: (file: string) => Titles, sqlite = false): Titles {
    const stamp = (name: string) => {
      try { const stat = fs.statSync(name); return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` } catch { return '' }
    }
    const mainStamp = stamp(file)
    const fingerprint = `${mainStamp}|${sqlite ? stamp(`${file}-wal`) : ''}`
    const cached = this.cache.get(file)
    if (cached?.fingerprint === fingerprint) return cached.titles
    try {
      const titles = mainStamp ? read(file) : new Map<string, string>()
      this.cache.set(file, { fingerprint, titles })
      return titles
    } catch { return cached?.titles ?? new Map() }
  }
}
