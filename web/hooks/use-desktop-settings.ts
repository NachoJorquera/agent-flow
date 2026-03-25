'use client'

import { useCallback, useState } from 'react'
import { DesktopSettings, getActiveBridge } from '@/lib/bridge-runtime'

export interface UseDesktopSettingsResult {
  supported: boolean
  loading: boolean
  saving: boolean
  error: string | null
  settings: DesktopSettings | null
  refresh: () => Promise<void>
  saveSettings: (partial: Partial<DesktopSettings>) => Promise<void>
}

export function useDesktopSettings(): UseDesktopSettingsResult {
  const bridge = getActiveBridge()
  const supported = !!(bridge?.getSettings && bridge?.updateSettings)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<DesktopSettings | null>(null)

  const refresh = useCallback(async () => {
    if (!bridge?.getSettings) return
    setLoading(true)
    setError(null)
    try {
      setSettings(await bridge.getSettings())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [bridge])

  const saveSettings = useCallback(async (partial: Partial<DesktopSettings>) => {
    if (!bridge?.updateSettings) return
    setSaving(true)
    setError(null)
    try {
      setSettings(await bridge.updateSettings(partial))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
      throw err
    } finally {
      setSaving(false)
    }
  }, [bridge])

  return { supported, loading, saving, error, settings, refresh, saveSettings }
}
