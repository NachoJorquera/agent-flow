'use client'

import { useEffect, useMemo, useState } from 'react'
import { DesktopSettings } from '@/lib/bridge-runtime'
import { COLORS } from '@/lib/colors'

interface SettingsFormProps {
  settings: DesktopSettings | null
  saving: boolean
  onSave: (partial: Partial<DesktopSettings>) => Promise<void>
}

export function SettingsForm({ settings, saving, onSave }: SettingsFormProps) {
  const initialState = useMemo(() => ({
    claudeProjectsPath: settings?.claudeProjectsPath ?? '~/.claude/projects',
    openFileStrategy: settings?.openFileStrategy ?? 'auto',
    editorCommandTemplate: settings?.editorCommandTemplate ?? '',
  }), [settings])

  const [claudeProjectsPath, setClaudeProjectsPath] = useState(initialState.claudeProjectsPath)
  const [openFileStrategy, setOpenFileStrategy] = useState(initialState.openFileStrategy)
  const [editorCommandTemplate, setEditorCommandTemplate] = useState(initialState.editorCommandTemplate)

  useEffect(() => {
    setClaudeProjectsPath(initialState.claudeProjectsPath)
    setOpenFileStrategy(initialState.openFileStrategy)
    setEditorCommandTemplate(initialState.editorCommandTemplate)
  }, [initialState])

  const dirty = claudeProjectsPath !== initialState.claudeProjectsPath
    || openFileStrategy !== initialState.openFileStrategy
    || editorCommandTemplate !== initialState.editorCommandTemplate

  return (
    <div className="space-y-3 text-[11px] font-mono">
      <div>
        <div className="mb-1" style={{ color: COLORS.holoBright }}>Desktop Settings</div>
        <div className="space-y-2">
          <label className="block">
            <div className="mb-1" style={{ color: COLORS.textMuted }}>Claude projects path</div>
            <input
              value={claudeProjectsPath}
              onChange={(e) => setClaudeProjectsPath(e.target.value)}
              onInput={(e) => setClaudeProjectsPath((e.target as HTMLInputElement).value)}
              className="w-full rounded px-2 py-1 bg-transparent"
              style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.holoBright }}
            />
          </label>

          <label className="block">
            <div className="mb-1" style={{ color: COLORS.textMuted }}>Open file strategy</div>
            <select
              value={openFileStrategy}
              onChange={(e) => setOpenFileStrategy(e.target.value as DesktopSettings['openFileStrategy'])}
              onInput={(e) => setOpenFileStrategy((e.target as HTMLSelectElement).value as DesktopSettings['openFileStrategy'])}
              className="w-full rounded px-2 py-1 bg-transparent"
              style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.holoBright }}
            >
              <option value="auto">auto</option>
              <option value="vscode">vscode</option>
              <option value="cursor">cursor</option>
              <option value="system">system</option>
            </select>
          </label>

          <label className="block">
            <div className="mb-1" style={{ color: COLORS.textMuted }}>Custom editor command</div>
            <input
              value={editorCommandTemplate}
              onChange={(e) => setEditorCommandTemplate(e.target.value)}
              onInput={(e) => setEditorCommandTemplate((e.target as HTMLInputElement).value)}
              placeholder='code -g "{file}:{line}"'
              className="w-full rounded px-2 py-1 bg-transparent"
              style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.holoBright }}
            />
          </label>

          <div className="flex items-center justify-between rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
            <span style={{ color: COLORS.textMuted }}>Hooks enabled</span>
            <span style={{ color: settings?.hooks.enabled ? COLORS.complete : COLORS.waiting_permission }}>
              {settings?.hooks.enabled ? 'Configured' : 'Not configured'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave({
            claudeProjectsPath,
            openFileStrategy,
            editorCommandTemplate: editorCommandTemplate.trim() || null,
          })}
          disabled={saving || !dirty}
          className="rounded px-2 py-1 cursor-pointer"
          style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.holoBright }}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button
          onClick={() => {
            setClaudeProjectsPath(initialState.claudeProjectsPath)
            setOpenFileStrategy(initialState.openFileStrategy)
            setEditorCommandTemplate(initialState.editorCommandTemplate)
          }}
          disabled={saving || !dirty}
          className="rounded px-2 py-1 cursor-pointer"
          style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.textMuted }}
        >
          Reset local edits
        </button>
      </div>
    </div>
  )
}
