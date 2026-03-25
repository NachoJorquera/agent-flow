import { describe, expect, it } from 'vitest'
import { buildOpenFileAttempts } from './open-file'
import type { DesktopSettings } from './types'

const baseSettings: DesktopSettings = {
  claudeProjectsPath: '/tmp/claude-projects',
  openFileStrategy: 'auto',
  editorCommandTemplate: null,
  hooks: { enabled: false, lastConfiguredAt: null, diagnosticsDismissed: false },
  ui: { windowBounds: null },
}

describe('buildOpenFileAttempts', () => {
  it('uses custom editor command before strategy fallbacks', () => {
    const attempts = buildOpenFileAttempts({ ...baseSettings, editorCommandTemplate: 'code -g "{file}:{line}"' }, '/tmp/file.ts', 7)
    expect(attempts[0]).toEqual({ kind: 'template', shellCommand: 'code -g "/tmp/file.ts:7"' })
  })

  it('uses vscode strategy directly', () => {
    const attempts = buildOpenFileAttempts({ ...baseSettings, openFileStrategy: 'vscode' }, '/tmp/file.ts', 7)
    expect(attempts).toContainEqual({ kind: 'command', command: 'code', args: ['-g', '/tmp/file.ts:7'] })
  })

  it('uses cursor strategy directly', () => {
    const attempts = buildOpenFileAttempts({ ...baseSettings, openFileStrategy: 'cursor' }, '/tmp/file.ts', 7)
    expect(attempts).toContainEqual({ kind: 'command', command: 'cursor', args: ['-g', '/tmp/file.ts:7'] })
  })

  it('omits line suffix when line is absent', () => {
    const attempts = buildOpenFileAttempts({ ...baseSettings, openFileStrategy: 'vscode' }, '/tmp/file.ts')
    expect(attempts).toContainEqual({ kind: 'command', command: 'code', args: ['/tmp/file.ts'] })
  })

  it('always falls back to system open', () => {
    const attempts = buildOpenFileAttempts(baseSettings, '/tmp/file.ts', 7)
    expect(attempts[attempts.length - 1]).toEqual({ kind: 'system' })
  })
})
