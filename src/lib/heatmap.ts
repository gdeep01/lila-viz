import type { EventType, MapId, PlayerEvent } from '../types'
import { worldToPixel } from '../types'

export type HeatmapMode = 'kills' | 'deaths' | 'traffic' | 'loot' | 'storm'

const MODE_EVENTS: Record<HeatmapMode, EventType[]> = {
  kills: ['Kill', 'BotKill'],
  deaths: ['Killed', 'BotKilled', 'KilledByStorm'],
  traffic: ['Position', 'BotPosition'],
  loot: ['Loot'],
  storm: ['KilledByStorm'],
}

const MODE_COLORS: Record<HeatmapMode, [number, number, number]> = {
  kills: [255, 50, 50],
  deaths: [180, 0, 255],
  traffic: [0, 180, 255],
  loot: [255, 200, 0],
  storm: [255, 120, 0],
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

type Scratch = {
  canvas: any
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  img: ImageData
  density: Float32Array
}

let scratch: Scratch | null = null

function getScratch(w: number, h: number): Scratch {
  if (scratch && scratch.w === w && scratch.h === h) return scratch
  const canvas: any =
    typeof (globalThis as any).OffscreenCanvas !== 'undefined'
      ? new (globalThis as any).OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          return c
        })()

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Heatmap scratch canvas context unavailable.')
  const img = ctx.createImageData(w, h)
  const density = new Float32Array(w * h)
  scratch = { canvas, ctx, w, h, img, density }
  return scratch
}

export function renderHeatmap(
  ctx: CanvasRenderingContext2D,
  events: PlayerEvent[],
  mapId: MapId,
  mode: HeatmapMode,
  radius: number,
  opacity: number,
  opts?: { maxDim?: number },
) {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  if (w === 0 || h === 0) return

  const allowed = new Set(MODE_EVENTS[mode])
  const filtered = events.filter((e) => allowed.has(e.event))
  ctx.clearRect(0, 0, w, h)
  if (filtered.length === 0) return

  // Render into a smaller offscreen buffer and scale up to improve performance.
  const maxDim = Math.max(128, Math.floor(opts?.maxDim ?? 512))
  const bufW = Math.min(maxDim, Math.min(w, h))
  const bufH = bufW
  const s = getScratch(bufW, bufH)
  const sctx = s.ctx
  sctx.clearRect(0, 0, bufW, bufH)
  s.density.fill(0)

  const density = s.density

  // Scale radius into buffer pixel space.
  const radiusScale = bufW / w
  const r = Math.max(2, Math.floor(radius * radiusScale))
  const sigma = r / 2.6
  const twoSigma2 = 2 * sigma * sigma
  const kernelSize = 2 * r + 1
  const kernel = new Float32Array(kernelSize * kernelSize)
  let kMax = 0
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy
      const val = Math.exp(-d2 / twoSigma2)
      const idx = (dy + r) * kernelSize + (dx + r)
      kernel[idx] = val
      if (val > kMax) kMax = val
    }
  }
  if (kMax > 0) {
    for (let i = 0; i < kernel.length; i++) kernel[i] /= kMax
  }

  const scaleX = bufW / 1024
  const scaleY = bufH / 1024
  let maxD = 0

  for (const e of filtered) {
    const [px1024, py1024] = worldToPixel(e.x, e.z, mapId)
    const cx = Math.floor(px1024 * scaleX)
    const cy = Math.floor(py1024 * scaleY)
    const x0 = clamp(cx - r, 0, bufW - 1)
    const x1 = clamp(cx + r, 0, bufW - 1)
    const y0 = clamp(cy - r, 0, bufH - 1)
    const y1 = clamp(cy + r, 0, bufH - 1)

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const kx = x - (cx - r)
        const ky = y - (cy - r)
        const kval = kernel[ky * kernelSize + kx] ?? 0
        const di = y * bufW + x
        const next = (density[di] += kval)
        if (next > maxD) maxD = next
      }
    }
  }

  if (maxD <= 0) return

  const [cr, cg, cb] = MODE_COLORS[mode]
  const img = s.img
  const data = img.data

  const o = clamp(opacity, 0, 1)
  for (let i = 0; i < density.length; i++) {
    const t = clamp(density[i] / maxD, 0, 1)
    const a = Math.floor(255 * o * Math.pow(t, 0.75))
    const di = i * 4
    data[di] = cr
    data[di + 1] = cg
    data[di + 2] = cb
    data[di + 3] = a
  }

  sctx.putImageData(img, 0, 0)

  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(s.canvas as any, 0, 0, w, h)
  ctx.restore()
}
