'use client'

import { DesktopHookStatus, DesktopSettings } from '@/lib/bridge-runtime'
import { COLORS } from '@/lib/colors'

interface HooksStatusCardProps {
  loading: boolean
  configuring: boolean
  status: DesktopHookStatus | null
  settings: DesktopSettings | null
  error: string | null
  onRefresh: () => Promise<void>
  onConfigure: () => Promise<void>
  onOpenClaudeSettings: () => Promise<void>
}

function statusValue(ok: boolean, goodLabel: string, badLabel: string) {
  return <span style={{ color: ok ? COLORS.complete : COLORS.waiting_permission }}>{ok ? goodLabel : badLabel}</span>
}

export function HooksStatusCard({
  loading, configuring, status, settings, error,
  onRefresh, onConfigure, onOpenClaudeSettings,
}: HooksStatusCardProps) {
  const healthy = !!status?.hookServerRunning && !!status.globalDiscoveryFileExists && !!status.claudeSettingsHasAgentFlowHooks

  return (
    <div className="space-y-3 text-[11px] font-mono">
      <div className="flex items-center justify-between">
        <div style={{ color: COLORS.holoBright }}>Claude Hooks</div>
        <div style={{ color: healthy ? COLORS.complete : COLORS.textMuted }}>
          {healthy ? 'Healthy' : 'Needs attention'}
        </div>
      </div>

      {error && (
        <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.waiting_permission}`, color: COLORS.waiting_permission }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
          <div style={{ color: COLORS.textMuted }}>Hook server</div>
          <div>{status ? statusValue(status.hookServerRunning, 'Running', 'Not running') : '—'}</div>
        </div>
        <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
          <div style={{ color: COLORS.textMuted }}>Port</div>
          <div style={{ color: COLORS.holoBright }}>{status?.hookPort ? `:${status.hookPort}` : '—'}</div>
        </div>
        <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
          <div style={{ color: COLORS.textMuted }}>Discovery</div>
          <div style={{ color: COLORS.holoBright }}>{status?.discoveryMode ?? '—'}</div>
        </div>
        <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
          <div style={{ color: COLORS.textMuted }}>Global discovery file</div>
          <div>{status ? statusValue(status.globalDiscoveryFileExists, 'Present', 'Missing') : '—'}</div>
        </div>
        <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
          <div style={{ color: COLORS.textMuted }}>Hook script</div>
          <div>{status ? statusValue(status.hookScriptInstalled, 'Installed', 'Unknown') : '—'}</div>
        </div>
        <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
          <div style={{ color: COLORS.textMuted }}>Claude settings</div>
          <div>{status ? statusValue(status.claudeSettingsHasAgentFlowHooks, 'Configured', 'Missing') : '—'}</div>
        </div>
      </div>

      <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.holoBorder06}` }}>
        <div style={{ color: COLORS.textMuted }}>Last configured</div>
        <div style={{ color: COLORS.holoBright }}>{settings?.hooks.lastConfiguredAt ?? 'Never'}</div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onConfigure()}
          disabled={configuring}
          className="rounded px-2 py-1 cursor-pointer"
          style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.holoBright }}
        >
          {configuring ? 'Configuring…' : 'Configure hooks'}
        </button>
        <button
          onClick={() => onRefresh()}
          disabled={loading || configuring}
          className="rounded px-2 py-1 cursor-pointer"
          style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.textMuted }}
        >
          {loading ? 'Refreshing…' : 'Refresh status'}
        </button>
        <button
          onClick={() => onOpenClaudeSettings()}
          disabled={configuring}
          className="rounded px-2 py-1 cursor-pointer"
          style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.textMuted }}
        >
          Open Claude settings
        </button>
      </div>
    </div>
  )
}
