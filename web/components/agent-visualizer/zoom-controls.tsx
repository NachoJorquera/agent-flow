'use client'

import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'

function ZoomButton({ label, onClick, children }: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded transition-all hover:scale-105 cursor-pointer"
      style={{
        background: COLORS.holoBg10,
        border: `1px solid ${COLORS.reviewBtnBorder}`,
        color: COLORS.textPrimary,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {children}
      </svg>
    </button>
  )
}

/** Zoom out and zoom in buttons at the bottom-left of the canvas, on the control bar's row; below 880px
 *  the centered 680px control bar reaches them, so they move above it. Render inside the canvas container. */
export function ZoomControls({ onZoomIn, onZoomOut }: { onZoomIn: () => void; onZoomOut: () => void }) {
  return (
    <div
      className="absolute bottom-4 max-[880px]:bottom-24 left-4 glass-card flex items-center gap-1.5"
      style={{ zIndex: Z.info }}
    >
      <ZoomButton label="Zoom out" onClick={onZoomOut}>
        <line x1="5" y1="12" x2="19" y2="12" />
      </ZoomButton>
      <ZoomButton label="Zoom in" onClick={onZoomIn}>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </ZoomButton>
    </div>
  )
}
