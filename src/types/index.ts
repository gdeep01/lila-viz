export type MapId = 'AmbroseValley' | 'GrandRift' | 'Lockdown'

export type EventType =
  | 'Position'
  | 'BotPosition'
  | 'Kill'
  | 'Killed'
  | 'BotKill'
  | 'BotKilled'
  | 'KilledByStorm'
  | 'Loot'

export interface PlayerEvent {
  user_id: string
  match_id: string
  map_id: MapId
  x: number
  y: number
  z: number
  ts: number // numeric ms (match-elapsed)
  event: EventType
  isBot: boolean
  day?: string
}

export interface MapConfig {
  scale: number
  originX: number
  originZ: number
  minimap: string
  label: string
}

export const MAP_CONFIGS: Record<MapId, MapConfig> = {
  AmbroseValley: {
    scale: 900,
    originX: -370,
    originZ: -473,
    minimap: '/minimaps/AmbroseValley_Minimap.png',
    label: 'Ambrose Valley',
  },
  GrandRift: {
    scale: 581,
    originX: -290,
    originZ: -290,
    minimap: '/minimaps/GrandRift_Minimap.png',
    label: 'Grand Rift',
  },
  Lockdown: {
    scale: 1000,
    originX: -500,
    originZ: -500,
    minimap: '/minimaps/Lockdown_Minimap.jpg',
    label: 'Lockdown',
  },
}

export function worldToPixel(x: number, z: number, mapId: MapId): [number, number] {
  const cfg = MAP_CONFIGS[mapId]
  const u = (x - cfg.originX) / cfg.scale
  const v = (z - cfg.originZ) / cfg.scale
  return [u * 1024, (1 - v) * 1024]
}

export interface MatchSummary {
  match_id: string
  map_id: MapId
  humanCount: number
  botCount: number
  eventCount: number
  minTs: number
  maxTs: number
  day?: string
}
