import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ClaudeHookEntry } from './protocol'
import { HOOK_TIMEOUT_S } from './constants'
import {
  HOOK_COMMAND_MARKER,
  getHookCommand,
  ensureHookScript,
} from './discovery'
import { createLogger } from './logger'

const log = createLogger('Hooks')

export interface HookConfigureResult {
  ok: boolean
  changed: boolean
  settingsPath: string
  error?: string
}

function isAgentFlowHook(entry: ClaudeHookEntry): boolean {
  return !!entry.hooks?.some(h => h.command?.includes(HOOK_COMMAND_MARKER))
}

export function hasAgentFlowHooks(settingsPath: string): boolean {
  try {
    if (!fs.existsSync(settingsPath)) return false
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const hooks = settings.hooks
    if (!hooks || typeof hooks !== 'object') return false
    return Object.values(hooks).some((entries: unknown) => {
      if (!Array.isArray(entries)) return false
      return entries.some((entry: unknown) => isAgentFlowHook(entry as ClaudeHookEntry))
    })
  } catch (err) {
    log.debug('Failed to read hooks settings:', err)
    return false
  }
}

export async function configureClaudeHooks(): Promise<HookConfigureResult> {
  ensureHookScript()

  const hookCommand = getHookCommand()
  const hookEntry = { hooks: [{ type: 'command', command: hookCommand, timeout: HOOK_TIMEOUT_S }] }
  const hooksConfig = {
    SessionStart: [hookEntry],
    PreToolUse: [hookEntry],
    PostToolUse: [hookEntry],
    PostToolUseFailure: [hookEntry],
    SubagentStart: [hookEntry],
    SubagentStop: [hookEntry],
    Notification: [hookEntry],
    Stop: [hookEntry],
    SessionEnd: [hookEntry],
  }

  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    let settings: Record<string, unknown> = {}
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    }

    let changed = false
    const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>
    for (const [event, entries] of Object.entries(hooksConfig)) {
      const existing = existingHooks[event] || []
      const filtered = existing.filter((entry: unknown) => !isAgentFlowHook(entry as ClaudeHookEntry))
      existingHooks[event] = [...filtered, ...entries]
      if (filtered.length !== existing.length || entries.length > 0) changed = true
    }

    settings.hooks = existingHooks
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    return { ok: true, changed, settingsPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, changed: false, settingsPath, error: message }
  }
}

export function migrateHttpHooks(): string[] {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  const changedPaths: string[] = []
  const hookCommand = getHookCommand()

  try {
    if (!fs.existsSync(settingsPath)) return changedPaths
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(raw)
    const hooks = settings.hooks
    if (!hooks || typeof hooks !== 'object') return changedPaths

    let changed = false
    for (const entries of Object.values(hooks) as unknown[][]) {
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        const e = entry as ClaudeHookEntry
        if (!e.hooks) continue
        for (const h of e.hooks) {
          if (h.url?.startsWith('http://127.0.0.1:')) {
            delete h.url
            h.type = 'command'
            h.command = hookCommand
            if (h.timeout === undefined) h.timeout = HOOK_TIMEOUT_S
            changed = true
          }
        }
      }
    }

    if (changed) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
      changedPaths.push(settingsPath)
      log.info(`Migrated HTTP hooks → command hooks in ${settingsPath}`)
    }
  } catch (err) {
    log.error(`Failed to migrate ${settingsPath}:`, err)
  }

  return changedPaths
}

