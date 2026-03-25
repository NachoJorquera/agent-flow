'use client'

import { useEffect } from 'react'
import { getActiveBridge } from '@/lib/bridge-runtime'
import { COLORS } from '@/lib/colors'
import { useDesktopSettings } from '@/hooks/use-desktop-settings'
import { useHooksStatus } from '@/hooks/use-hooks-status'
import { GlassCard } from './glass-card'
import { PanelHeader, stopPropagationHandlers } from './shared-ui'
import { SettingsForm } from './settings-form'
import { HooksStatusCard } from './hooks-status-card'

interface SettingsPanelProps {
  visible: boolean
  onClose: () => void
}

export function SettingsPanel({ visible, onClose }: SettingsPanelProps) {
  const bridge = getActiveBridge()
  const settingsState = useDesktopSettings()
  const hooksState = useHooksStatus()
  const supported = !!(bridge?.getSettings || bridge?.getHooksStatus)

  useEffect(() => {
    if (!visible || !supported) return
    void settingsState.refresh()
    void hooksState.refresh()
  }, [visible, supported, settingsState.refresh, hooksState.refresh])

  if (!visible || !supported) return null

  return (
    <div
      className="absolute top-16 right-3 w-[520px] max-w-[calc(100vw-24px)]"
      style={{ zIndex: 40 }}
      {...stopPropagationHandlers}
    >
      <GlassCard visible={visible}>
        <PanelHeader onClose={onClose}>Settings &amp; Hooks</PanelHeader>
        <div className="space-y-4">
          {settingsState.supported && (
            <SettingsForm
              settings={settingsState.settings}
              saving={settingsState.saving}
              onSave={settingsState.saveSettings}
            />
          )}

          {hooksState.supported && (
            <HooksStatusCard
              loading={hooksState.loading}
              configuring={hooksState.configuring}
              status={hooksState.status}
              settings={settingsState.settings}
              error={hooksState.error}
              onRefresh={hooksState.refresh}
              onConfigure={hooksState.configure}
              onOpenClaudeSettings={hooksState.openClaudeSettings}
            />
          )}

          {(settingsState.error || hooksState.error) && (
            <div className="rounded px-2 py-1" style={{ border: `1px solid ${COLORS.waiting_permission}`, color: COLORS.waiting_permission }}>
              {settingsState.error ?? hooksState.error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded px-2 py-1 text-[11px] font-mono cursor-pointer"
              style={{ border: `1px solid ${COLORS.holoBorder06}`, color: COLORS.textMuted }}
            >
              Close
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
