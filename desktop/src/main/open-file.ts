import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { DesktopSettings } from './types'

const execFileAsync = promisify(execFile)

export interface OpenFileAttempt {
  kind: 'template' | 'command' | 'system'
  command?: string
  args?: string[]
  shellCommand?: string
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('bash', ['-lc', `command -v ${command}`])
    return true
  } catch {
    return false
  }
}

function applyTemplate(template: string, filePath: string, line?: number): string {
  return template.replaceAll('{file}', filePath).replaceAll('{line}', String(line ?? 1))
}

export function buildOpenFileAttempts(settings: DesktopSettings, filePath: string, line?: number): OpenFileAttempt[] {
  const attempts: OpenFileAttempt[] = []

  if (settings.editorCommandTemplate) {
    attempts.push({
      kind: 'template',
      shellCommand: applyTemplate(settings.editorCommandTemplate, filePath, line),
    })
  }

  const vscodeArgs = line ? ['-g', `${filePath}:${line}`] : [filePath]
  const cursorArgs = line ? ['-g', `${filePath}:${line}`] : [filePath]

  if (settings.openFileStrategy === 'vscode') {
    attempts.push({ kind: 'command', command: 'code', args: vscodeArgs })
  } else if (settings.openFileStrategy === 'cursor') {
    attempts.push({ kind: 'command', command: 'cursor', args: cursorArgs })
  } else if (settings.openFileStrategy === 'auto') {
    attempts.push({ kind: 'command', command: 'code', args: vscodeArgs })
    attempts.push({ kind: 'command', command: 'cursor', args: cursorArgs })
  }

  attempts.push({ kind: 'system' })
  return attempts
}

export async function openFileWithStrategy(settings: DesktopSettings, filePath: string, line?: number): Promise<void> {
  const runCommand = async (command: string, args: string[]) => {
    await execFileAsync(command, args)
  }

  const tryCode = async () => {
    if (!(await commandExists('code'))) throw new Error('code not found')
    await runCommand('code', line ? ['-g', `${filePath}:${line}`] : [filePath])
  }

  const tryCursor = async () => {
    if (!(await commandExists('cursor'))) throw new Error('cursor not found')
    await runCommand('cursor', line ? ['-g', `${filePath}:${line}`] : [filePath])
  }

  for (const attempt of buildOpenFileAttempts(settings, filePath, line)) {
    try {
      if (attempt.kind === 'template' && attempt.shellCommand) {
        await execFileAsync('bash', ['-lc', attempt.shellCommand])
        return
      }
      if (attempt.kind === 'command' && attempt.command) {
        if (attempt.command === 'code') {
          await tryCode()
          return
        }
        if (attempt.command === 'cursor') {
          await tryCursor()
          return
        }
        await runCommand(attempt.command, attempt.args ?? [])
        return
      }
      if (attempt.kind === 'system') {
        await shell.openPath(filePath)
        return
      }
    } catch {
      // continue to next attempt
    }
  }
}
