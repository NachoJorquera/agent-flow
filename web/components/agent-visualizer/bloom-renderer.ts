/**
 * Bloom post-processing for holographic glow effect.
 * Takes the main canvas, extracts bright areas, blurs them,
 * and composites back with additive blending.
 */

/** Glow spread: one gaussian blur as wide as chained 8, 6 and 4 px blurs (variances add). */
const BLUR_STD_DEV_PX = Math.hypot(8, 6, 4)

export class BloomRenderer {
  private bloomCanvas: HTMLCanvasElement
  private bloomCtx: CanvasRenderingContext2D
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D
  private intensity: number

  private enabled: boolean

  constructor(intensity: number = 0.6) {
    this.intensity = intensity
    this.bloomCanvas = document.createElement('canvas')
    this.tempCanvas = document.createElement('canvas')
    const bCtx = this.bloomCanvas.getContext('2d')
    const tCtx = this.tempCanvas.getContext('2d')
    this.enabled = !!(bCtx && tCtx)
    this.bloomCtx = bCtx!
    this.tempCtx = tCtx!
  }

  resize(width: number, height: number): void {
    // Bloom at half resolution for performance
    const scale = 0.5
    this.bloomCanvas.width = width * scale
    this.bloomCanvas.height = height * scale
    this.tempCanvas.width = width * scale
    this.tempCanvas.height = height * scale
  }

  apply(sourceCanvas: HTMLCanvasElement, targetCtx: CanvasRenderingContext2D): void {
    const w = this.bloomCanvas.width
    const h = this.bloomCanvas.height

    if (w === 0 || h === 0 || !this.enabled) return

    // Draw source at half resolution
    this.bloomCtx.clearRect(0, 0, w, h)
    this.bloomCtx.drawImage(sourceCanvas, 0, 0, w, h)

    // Blur once into the temp canvas (CSS filter blur is gaussian)
    this.tempCtx.clearRect(0, 0, w, h)
    this.tempCtx.filter = `blur(${BLUR_STD_DEV_PX}px)`
    this.tempCtx.drawImage(this.bloomCanvas, 0, 0)
    this.tempCtx.filter = 'none'

    // Composite bloom over the target with additive blending
    targetCtx.save()
    targetCtx.globalCompositeOperation = 'lighter'
    targetCtx.globalAlpha = this.intensity
    targetCtx.drawImage(this.tempCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height)
    targetCtx.restore()
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity))
  }
}
