import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodexSessionTitles } from './codex-session-titles'

describe('saved Codex session titles', () => {
  let root: string
  let t3Dir: string
  let titles: CodexSessionTitles
  const sql = (file: string, query: string) => execFileSync('/usr/bin/sqlite3', [file, query])

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-titles-'))
    t3Dir = path.join(root, 't3')
    fs.mkdirSync(t3Dir)
    titles = new CodexSessionTitles(root, t3Dir)
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('matches T3 titles by native session id and prefers them over Codex prompt-derived titles', () => {
    sql(path.join(root, 'state_5.sqlite'), `CREATE TABLE threads (id TEXT, title TEXT, name TEXT);
      INSERT INTO threads VALUES ('native-1', 'Initial prompt', NULL), ('native-2', 'Other prompt', 'Saved Codex name');`)
    const db = path.join(t3Dir, 'statev2.sqlite')
    sql(db, `CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, title TEXT, deleted_at TEXT);
      CREATE TABLE orchestration_v2_projection_provider_threads (thread_id TEXT, provider TEXT, payload_json TEXT);
      INSERT INTO orchestration_v2_projection_threads VALUES ('t3-1', 'Horizontal nodes', NULL);
      INSERT INTO orchestration_v2_projection_provider_threads VALUES ('t3-1', 'codex', '{"nativeThreadRef":{"nativeId":"native-1"}}');`)
    titles.refresh()
    expect(titles.get('native-1')).toBe('Horizontal nodes')
    expect(titles.get('native-2')).toBe('Saved Codex name')
    expect(titles.get('unknown')).toBeUndefined()

    sql(db, "UPDATE orchestration_v2_projection_threads SET title = 'Renamed layout'")
    titles.refresh()
    expect(titles.get('native-1')).toBe('Renamed layout')
  })

  it('reads older Codex schemas and lets session-index names override generated database titles', () => {
    sql(path.join(root, 'state_5.sqlite'), `CREATE TABLE threads (id TEXT, title TEXT);
      INSERT INTO threads VALUES ('native-1', 'Database name');`)
    titles.refresh()
    expect(titles.get('native-1')).toBe('Database name')
    fs.writeFileSync(path.join(root, 'session_index.jsonl'),
      JSON.stringify({ id: 'native-1', thread_name: 'Saved name' }) + '\n' + '{"incomplete":')
    titles.refresh()
    expect(titles.get('native-1')).toBe('Saved name')
  })

  it('tolerates unavailable metadata and keeps the last known names while a database is unreadable', () => {
    titles.refresh()
    expect(titles.get('native-1')).toBeUndefined()
    const file = path.join(root, 'state_5.sqlite')
    sql(file, "CREATE TABLE threads (id TEXT, title TEXT); INSERT INTO threads VALUES ('native-1', 'Saved name');")
    titles.refresh()
    fs.writeFileSync(file, 'temporarily unreadable')
    titles.refresh()
    expect(titles.get('native-1')).toBe('Saved name')
  })
})
