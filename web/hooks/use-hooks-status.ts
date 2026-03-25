'use client'

import { useCallback, useState } from 'react'
import { DesktopHookStatus, getActiveBridge } from '@/lib/bridge-runtime'

export interface UseHooksStatusResult {
  supported: boolean
  loading: boolean
  configuring: boolean
  error: string | null
  status: DesktopHookStatus | null
  refresh: () => Promise<void>
  configure: () => Promise<void>
  openClaudeSettings: () => Promise<void>
}

export function useHooksStatus(): UseHooksStatusResult {
  const bridge = getActiveBridge()
  const supported = !!(bridge?.getHooksStatus && bridge?.configureHooks && bridge?.openClaudeSettings)
  const [loading, setLoading] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<DesktopHookStatus | null>(null)

  const refresh = useCallback(async () => {
    if (!bridge?.getHooksStatus) return
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await bridge.getHooksStatus()
      setStatus(nextStatus)
      setError(nextStatus.lastError)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hook status')
    } finally {
      setLoading(false)
    }
  }, [bridge])

  const configure = useCallback(async () => {
    if (!bridge?.configureHooks) return
    setConfiguring(true)
    setError(null)
    try {
      const nextStatus = await bridge.configureHooks()
      setStatus(nextStatus)
      setError(nextStatus.lastError)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure hooks')
      throw err
    } finally {
      setConfiguring(false)
    }
  }, [bridge])

  const openClaudeSettings = useCallback(async () => {
    if (!bridge?.openClaudeSettings) return
    try {
      await bridge.openClaudeSettings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open Claude settings')
      throw err
    }
  }, [bridge])

  return { supported, loading, configuring, error, status, refresh, configure, openClaudeSettings }
}
