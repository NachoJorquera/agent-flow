import { ToolCallNode } from '@/lib/agent-types'
import { COLORS, withAlpha } from '@/lib/colors'
import { TOOL_MAX_CARD_W, TOOL_DRAW } from '@/lib/canvas-constants'
import { wrapTextCached } from './draw-bubbles'
import { measureTextCached } from './render-cache'

const LABEL_FONT = `${TOOL_DRAW.fontSize}px monospace`
const ERROR_FONT = `${TOOL_DRAW.errorFontSize}px monospace`
const TOKEN_FONT = `${TOOL_DRAW.tokenFontSize}px monospace`

interface ToolCardLayout {
  cardW: number
  cardH: number
  labelLines: string[]
  /** Wrapped error message, or the token cost line of a completed card */
  detailLines: string[]
}

function widestLine(ctx: CanvasRenderingContext2D, lines: string[]): number {
  return Math.max(0, ...lines.map(line => measureTextCached(ctx, line)))
}

/** Wraps the card's full text at the max card width and sizes the card to fit it */
function getToolCardLayout(ctx: CanvasRenderingContext2D, tool: ToolCallNode, isRunning: boolean, isError: boolean): ToolCardLayout {
  const maxTextW = TOOL_MAX_CARD_W - 12
  ctx.font = LABEL_FONT
  const labelLines = wrapTextCached(ctx, isError ? `${tool.toolName}: FAILED` : `${tool.toolName}: ${tool.args}`, maxTextW)
  let textW = widestLine(ctx, labelLines)

  let detailLines: string[] = []
  if (isError) {
    ctx.font = ERROR_FONT
    detailLines = wrapTextCached(ctx, tool.errorMessage || tool.result || '', maxTextW)
    textW = Math.max(textW, widestLine(ctx, detailLines))
  } else if (!isRunning && tool.tokenCost) {
    detailLines = [`${tool.tokenCost} tok`]
  }

  const detailH = detailLines.length > 0
    ? TOOL_DRAW.expandedHeight - TOOL_DRAW.collapsedHeight + (detailLines.length - 1) * TOOL_DRAW.detailLineHeight
    : 0
  return {
    cardW: Math.max(60, Math.min(textW + 12, TOOL_MAX_CARD_W)),
    cardH: TOOL_DRAW.collapsedHeight + (labelLines.length - 1) * TOOL_DRAW.lineHeight + detailH,
    labelLines,
    detailLines,
  }
}

/** Draws the label lines and then the detail lines as one block centered on the card */
function drawToolCardText(ctx: CanvasRenderingContext2D, tool: ToolCallNode, layout: ToolCardLayout, isRunning: boolean, isError: boolean) {
  const { labelLines, detailLines } = layout
  const detailBlockH = detailLines.length > 0 ? TOOL_DRAW.detailGap + detailLines.length * TOOL_DRAW.detailLineHeight : 0
  const contentH = labelLines.length * TOOL_DRAW.lineHeight + detailBlockH
  let lineY = tool.y - contentH / 2 + TOOL_DRAW.lineHeight / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = LABEL_FONT
  ctx.fillStyle = isRunning ? COLORS.tool : isError ? COLORS.error : COLORS.return
  for (const line of labelLines) {
    ctx.fillText(line, tool.x, lineY)
    lineY += TOOL_DRAW.lineHeight
  }

  if (detailLines.length === 0) return
  lineY += TOOL_DRAW.detailGap - TOOL_DRAW.lineHeight / 2 + TOOL_DRAW.detailLineHeight / 2
  ctx.font = isError ? ERROR_FONT : TOKEN_FONT
  ctx.fillStyle = isError ? COLORS.error + 'aa' : COLORS.tool + '90'
  for (const line of detailLines) {
    ctx.fillText(line, tool.x, lineY)
    lineY += TOOL_DRAW.detailLineHeight
  }
}

export function drawToolCalls(
  ctx: CanvasRenderingContext2D,
  toolCalls: Map<string, ToolCallNode>,
  time: number,
  selectedToolCallId?: string | null,
) {
  for (const [id, tool] of toolCalls) {
    const isRunning = tool.state === 'running'
    const isError = tool.state === 'error'
    const pulse = isRunning ? Math.sin(time * 4) * 0.2 + 0.8 : isError ? Math.sin(time * 6) * 0.15 + 0.85 : 0.5

    ctx.save()
    ctx.globalAlpha = tool.opacity

    const layout = getToolCardLayout(ctx, tool, isRunning, isError)
    const { cardW, cardH } = layout
    // Cache dimensions so hit-detection can use exact same values
    tool._cachedW = cardW
    tool._cachedH = cardH
    const cardX = tool.x - cardW / 2
    const cardY = tool.y - cardH / 2

    const isSelected = id === selectedToolCallId

    // Error glow
    if (isError) {
      ctx.shadowColor = COLORS.error
      ctx.shadowBlur = TOOL_DRAW.errorGlowBase + Math.sin(time * 6) * TOOL_DRAW.errorGlowPulse
    }

    ctx.beginPath()
    ctx.roundRect(cardX, cardY, cardW, cardH, TOOL_DRAW.borderRadius)
    ctx.fillStyle = isError
      ? withAlpha(COLORS.toolCardErrorBase, 0.8 * pulse)
      : isSelected ? withAlpha(COLORS.toolCardSelectedBase, 0.15 * pulse) : withAlpha(COLORS.toolCardBase, 0.7 * pulse)
    ctx.fill()
    ctx.strokeStyle = isError
      ? COLORS.error + '90'
      : isSelected ? COLORS.holoBase + 'aa' : isRunning ? COLORS.tool + '60' : COLORS.return + '40'
    ctx.lineWidth = isError ? 2 : isSelected ? 1.5 : 1
    ctx.stroke()

    ctx.shadowBlur = 0

    // Spinning ring
    if (isRunning) {
      ctx.beginPath()
      ctx.arc(tool.x, tool.y, Math.max(cardW, cardH) / 2 + TOOL_DRAW.spinRingPadding, time * TOOL_DRAW.spinSpeed, time * TOOL_DRAW.spinSpeed + TOOL_DRAW.spinArc)
      ctx.strokeStyle = COLORS.tool + '50'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Crack lines for errors
    if (isError) {
      ctx.save()
      ctx.strokeStyle = COLORS.error + '40'
      ctx.lineWidth = 0.8
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5
        ctx.beginPath()
        ctx.moveTo(tool.x, tool.y)
        ctx.lineTo(tool.x + Math.cos(a) * cardW * 0.5, tool.y + Math.sin(a) * cardH * 0.6)
        ctx.stroke()
      }
      ctx.restore()
    }

    drawToolCardText(ctx, tool, layout, isRunning, isError)

    ctx.restore()
  }
}
