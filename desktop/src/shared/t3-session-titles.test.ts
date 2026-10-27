import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { T3SessionTitles } from './t3-session-titles'

const sqlite = process.platform === 'darwin' ? '/usr/bin/sqlite3' : 'sqlite3'
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

describe('T3SessionTitles', () => {
  let root: string
  let database: string
  let titles: T3SessionTitles

  function execute(sql: string): void {
    execFileSync(sqlite, [database, sql])
  }

  function addThread(id: string, provider: string, nativeId: string, title: string, owner: string | null = null): void {
    const payload = JSON.stringify({ nativeThreadRef: { driver: provider, nativeId } })
    execute(`
      INSERT INTO orchestration_v2_projection_threads VALUES (${literal(id)}, ${literal(title)}, NULL);
      INSERT INTO orchestration_v2_projection_provider_threads VALUES (
        ${literal(id)}, ${literal(provider)}, ${literal(payload)}, ${owner ? literal(owner) : 'NULL'}
      );`)
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-t3-titles-'))
    database = path.join(root, 'statev2.sqlite')
    titles = new T3SessionTitles({ dataDir: root })
    execute(`
      CREATE TABLE projection_threads (thread_id TEXT, title TEXT, deleted_at TEXT);
      CREATE TABLE projection_thread_sessions (thread_id TEXT, provider_name TEXT, provider_thread_id TEXT);
      CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, title TEXT, deleted_at TEXT);
      CREATE TABLE orchestration_v2_projection_provider_threads (thread_id TEXT, driver TEXT, payload_json TEXT, owner_node_id TEXT);
    `)
  })

  afterEach(() => {
    titles.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('resolves native Codex and Claude sessions and excludes child nodes and deleted threads', async () => {
    addThread('codex-thread', 'codex', 'native-codex', "User's real title")
    addThread('claude-thread', 'claudeAgent', 'native-claude', 'Sincronizar repositorios')
    addThread('child-thread', 'codex', 'native-child', 'Child task', 'parent-node')
    addThread('deleted-thread', 'codex', 'native-deleted', 'Deleted title')
    execute("UPDATE orchestration_v2_projection_threads SET deleted_at = '2026-10-26' WHERE thread_id = 'deleted-thread'")

    await titles.refresh()

    expect(titles.get('codex:native-codex')).toBe("User's real title")
    expect(titles.getSessionId('codex-thread')).toBe('codex:native-codex')
    expect(titles.getSessionId('claude-thread')).toBe('native-claude')
    expect(titles.get('native-claude')).toBe('Sincronizar repositorios')
    expect(titles.get('codex:native-child')).toBeUndefined()
    expect(titles.get('codex:native-deleted')).toBeUndefined()
  })

  it('supports the legacy database schema', async () => {
    execute(`
      DROP TABLE orchestration_v2_projection_threads;
      DROP TABLE orchestration_v2_projection_provider_threads;
      INSERT INTO projection_threads VALUES ('thread', 'Legacy session title', NULL);
      INSERT INTO projection_thread_sessions VALUES ('thread', 'codex', 'native');
    `)
    fs.renameSync(database, path.join(root, 'state.sqlite'))

    await titles.refresh()

    expect(titles.get('codex:native')).toBe('Legacy session title')
  })

  it('picks up title changes written only to the WAL and notifies existing sessions', async () => {
    addThread('thread', 'codex', 'native', 'Initial title')
    execute('PRAGMA journal_mode=WAL;')
    const writer = spawn(sqlite, [database])
    const changed: string[][] = []
    titles.onChange(ids => changed.push(ids))
    try {
      await writeAndWait(writer, 'SELECT title FROM orchestration_v2_projection_threads;')
      await titles.refresh()
      const initialMtime = fs.statSync(database).mtimeMs

      await writeAndWait(writer, "UPDATE orchestration_v2_projection_threads SET title = 'Renamed title';")
      expect(fs.statSync(database).mtimeMs).toBe(initialMtime)
      await titles.refresh()

      expect(titles.get('codex:native')).toBe('Renamed title')
      expect(changed).toEqual([['codex:native'], ['codex:native']])
      await titles.refresh()
      expect(changed).toHaveLength(2)
    } finally {
      await new Promise<void>(resolve => {
        writer.once('exit', () => resolve())
        writer.stdin.end()
      })
    }
  })

  it('continues without T3 metadata when its database is missing or unavailable', async () => {
    fs.rmSync(database)
    await expect(titles.refresh()).resolves.toBeUndefined()
    fs.writeFileSync(database, 'not a SQLite database')
    await expect(titles.refresh()).resolves.toBeUndefined()
    expect(titles.get('codex:native')).toBeUndefined()
  })
})

function writeAndWait(writer: ChildProcessWithoutNullStreams, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('query-done')) {
        writer.stdout.off('data', onData)
        writer.off('error', reject)
        resolve()
      }
    }
    writer.once('error', reject)
    writer.stdout.on('data', onData)
    writer.stdin.write(`${sql}\nSELECT 'query-done';\n`)
  })
}
