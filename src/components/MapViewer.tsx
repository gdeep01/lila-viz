import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapId, PlayerEvent } from '../types'
import { MAP_CONFIGS, worldToPixel } from '../types'
import { renderHeatmap, type HeatmapMode } from '../lib/heatmap'

const HUMAN_COLORS = [
  '#ff3a3a',
  '#00b4ff',
  '#38d996',
  '#ffb020',
  '#b400ff',
  '#ff7a00',
  '#7cff00',
  '#00ffd5',
  '#ff00a8',
  '#8ab4ff',
]

function hashToIndex(s: string, mod: number) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % mod
}

function isPositionEvent(e: PlayerEvent) {
  return e.event === 'Position' || e.event === 'BotPosition'
}

function upperBoundByTs(events: PlayerEvent[], ts: number): number {
  // First index with events[i].ts > ts (events are sorted by ts).
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (events[mid]!.ts <= ts) lo = mid + 1
    else hi = mid
  }
  return lo
}

type Props = {
  mapId: MapId
  events: PlayerEvent[]
  heatmapMode: HeatmapMode | 'none'
  heatmapRadius: number
  heatmapOpacity: number
  showPaths: boolean
  showEvents: boolean
  showHumans: boolean
  showBots: boolean
  playbackTs?: number | null
}

export default function MapViewer(props: Props) {
  const {
    mapId,
    events,
    heatmapMode,
    heatmapRadius,
    heatmapOpacity,
    showPaths,
    showEvents,
    showHumans,
    showBots,
    playbackTs,
  } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const minimapRef = useRef<HTMLCanvasElement | null>(null)
  const heatmapRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())

  const [size, setSize] = useState(640)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      const next = Math.max(240, Math.floor(Math.min(rect.width, rect.height)))
      setSize(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  useEffect(() => {
    const canvases = [minimapRef.current, heatmapRef.current, overlayRef.current].filter(
      Boolean,
    ) as HTMLCanvasElement[]
    for (const c of canvases) {
      c.style.width = `${size}px`
      c.style.height = `${size}px`
      c.width = Math.floor(size * dpr)
      c.height = Math.floor(size * dpr)
    }
  }, [size, dpr])

  useEffect(() => {
    const canvas = minimapRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cfg = MAP_CONFIGS[mapId]
    const key = cfg.minimap
    const cached = imageCacheRef.current.get(key)

    const paintFallback = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1)
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.font = `${Math.floor(14 * dpr)}px JetBrains Mono, monospace`
      ctx.fillText('Minimap missing', Math.floor(20 * dpr), Math.floor(28 * dpr))
    }

    const draw = (img: HTMLImageElement) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1)
    }

    if (cached && cached.complete && cached.naturalWidth > 0) {
      draw(cached)
      return
    }

    const img = cached ?? new Image()
    if (!cached) {
      img.crossOrigin = 'anonymous'
      img.src = key
      imageCacheRef.current.set(key, img)
    }

    const onLoad = () => draw(img)
    const onErr = () => paintFallback()

    img.addEventListener('load', onLoad)
    img.addEventListener('error', onErr)
    if (img.complete && img.naturalWidth > 0) draw(img)
    return () => {
      img.removeEventListener('load', onLoad)
      img.removeEventListener('error', onErr)
    }
  }, [mapId, size, dpr])

  const eventsForDraw = useMemo(() => {
    if (playbackTs == null) return events
    const end = upperBoundByTs(events, playbackTs)
    return end >= events.length ? events : events.slice(0, end)
  }, [events, playbackTs])

  useEffect(() => {
    const canvas = heatmapRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (heatmapMode === 'none') return
    renderHeatmap(ctx, eventsForDraw, mapId, heatmapMode, heatmapRadius * dpr, heatmapOpacity, { maxDim: 512 })
  }, [eventsForDraw, mapId, heatmapMode, heatmapRadius, heatmapOpacity, dpr])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const scaleX = canvas.width / 1024
    const scaleY = canvas.height / 1024

    const byUser = new Map<string, PlayerEvent[]>()
    for (const e of eventsForDraw) {
      const arr = byUser.get(e.user_id)
      if (arr) arr.push(e)
      else byUser.set(e.user_id, [e])
    }

    const drawMarker = (e: PlayerEvent, x: number, y: number) => {
      const fontSize = Math.floor(12 * dpr)
      ctx.font = `${fontSize}px JetBrains Mono, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      let icon = ''
      let color = 'rgba(255,255,255,0.8)'
      if (e.event === 'Kill' || e.event === 'BotKill') {
        icon = '✕'
        color = 'rgba(255,50,50,0.95)'
      } else if (e.event === 'Killed' || e.event === 'BotKilled') {
        icon = '☠'
        color = 'rgba(180,0,255,0.95)'
      } else if (e.event === 'KilledByStorm') {
        icon = '⚡'
        color = 'rgba(255,120,0,0.95)'
      } else if (e.event === 'Loot') {
        icon = '◆'
        color = 'rgba(255,200,0,0.95)'
      } else {
        return
      }

      ctx.beginPath()
      ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 1 * dpr
      ctx.stroke()

      ctx.fillStyle = color
      ctx.fillText(icon, x, y + 0.5 * dpr)
    }

    for (const [userId, evs] of byUser.entries()) {
      const isBot = evs[0]?.isBot ?? false
      if (isBot && !showBots) continue
      if (!isBot && !showHumans) continue

      const pos = evs.filter(isPositionEvent)
      const markers = evs.filter((e) => !isPositionEvent(e))

      if (showPaths && pos.length >= 2) {
        ctx.beginPath()
        for (let i = 0; i < pos.length; i++) {
          const [px, py] = worldToPixel(pos[i].x, pos[i].z, mapId)
          const x = px * scaleX
          const y = py * scaleY
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }

        if (isBot) {
          ctx.strokeStyle = 'rgba(255,180,80,0.35)'
          ctx.lineWidth = 0.8 * dpr
        } else {
          const c = HUMAN_COLORS[hashToIndex(userId, HUMAN_COLORS.length)]
          ctx.strokeStyle = c
          ctx.lineWidth = 1.5 * dpr
        }
        ctx.stroke()
      }

      if (showEvents) {
        for (const e of markers) {
          const [px, py] = worldToPixel(e.x, e.z, mapId)
          drawMarker(e, px * scaleX, py * scaleY)
        }
      }

      if (playbackTs != null) {
        const lastPos = pos.length ? pos[pos.length - 1] : null
        if (lastPos) {
          const [px, py] = worldToPixel(lastPos.x, lastPos.z, mapId)
          const x = px * scaleX
          const y = py * scaleY
          ctx.beginPath()
          ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2)
          ctx.fillStyle = isBot ? 'rgba(255,180,80,0.85)' : 'rgba(255,255,255,0.9)'
          ctx.fill()
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'
          ctx.lineWidth = 1.2 * dpr
          ctx.stroke()
        }
      }
    }
  }, [eventsForDraw, mapId, showBots, showHumans, showPaths, showEvents, playbackTs, dpr])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        <canvas ref={minimapRef} style={{ position: 'absolute', inset: 0 }} />
        <canvas ref={heatmapRef} style={{ position: 'absolute', inset: 0 }} />
        <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0 }} />
      </div>
    </div>
  )
}
