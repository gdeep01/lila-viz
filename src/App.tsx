import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import MapViewer from './components/MapViewer'
import { useDataLoader } from './hooks/useDataLoader'
import type { MapId, MatchSummary, PlayerEvent } from './types'
import { MAP_CONFIGS } from './types'
import type { HeatmapMode } from './lib/heatmap'

type HeatmapUiMode = 'none' | 'traffic' | 'kills' | 'deaths' | 'loot' | 'storm'

const PLAYBACK_TICK_MS = 100
const PLAYBACK_MIN_TICKS = 600
const PLAYBACK_DURATION_FACTOR = 500
const LOOKUP_USER_RESULTS_LIMIT = 20
const LOOKUP_MATCH_RESULTS_LIMIT = 60

function formatMs(ms: number) {
  if (!ms || ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function looksLikeMatchId(input: string) {
  return input.includes('.')
}

function truncateId(id: string, n = 18) {
  return id.length > n ? `${id.slice(0, n)}...` : id
}

export default function App() {
  const loader = useDataLoader()

  const [mapId, setMapId] = useState<MapId>('AmbroseValley')
  const [selected, setSelected] = useState<MatchSummary | null>(null)
  const [events, setEvents] = useState<PlayerEvent[]>([])
  const [eventsStatus, setEventsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [matchQuery, setMatchQuery] = useState('')
  const [dayFilter, setDayFilter] = useState<string>('All')

  const [showPaths, setShowPaths] = useState(true)
  const [showEvents, setShowEvents] = useState(true)
  const [showHumans, setShowHumans] = useState(true)
  const [showBots, setShowBots] = useState(true)

  const [heatmapMode, setHeatmapMode] = useState<HeatmapUiMode>('none')
  const [heatmapRadius, setHeatmapRadius] = useState(18)
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.7)

  const [playbackTs, setPlaybackTs] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<number | null>(null)
  const pickingRef = useRef(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
  const [isDragOver, setIsDragOver] = useState(false)

  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupResult, setLookupResult] = useState<
    | null
    | { kind: 'user'; userId: string; rows: any[] }
    | { kind: 'match'; prefix: string; rows: any[] }
  >(null)

  const matchesForMap = useMemo(
    () => {
      const base = loader.matches.filter((m) => m.map_id === mapId)
      const byDay =
        dayFilter === 'All' ? base : base.filter((m) => (m.day ?? 'Unknown') === dayFilter)
      const q = matchQuery.trim().toLowerCase()
      if (!q) return byDay
      return byDay.filter((m) => m.match_id.toLowerCase().includes(q))
    },
    [loader.matches, mapId, matchQuery, dayFilter],
  )

  const daysForMap = useMemo(() => {
    const set = new Set<string>()
    for (const m of loader.matches) {
      if (m.map_id !== mapId) continue
      set.add(m.day ?? 'Unknown')
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [loader.matches, mapId])

  useEffect(() => {
    if (selected && selected.map_id !== mapId) {
      setSelected(null)
      setEvents([])
      setPlaybackTs(null)
      setPlaying(false)
    }
    setMatchQuery('')
    setDayFilter('All')
  }, [mapId, selected])

  useEffect(() => {
    if (!selected) return
    setEventsStatus('loading')
    setEventsError(null)
    setPlaying(false)
    setPlaybackTs(null)

    loader.queryEvents(selected.match_id)
      .then((rows) => {
        setEvents(rows)
        setEventsStatus('ready')
      })
      .catch((e: any) => {
        setEventsStatus('error')
        setEventsError(e?.message ? String(e.message) : 'Failed to query match events.')
      })
  }, [selected?.match_id, loader.queryEvents])

  const eventCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of events) counts[e.event] = (counts[e.event] ?? 0) + 1
    return counts
  }, [events])

  const minTs = selected?.minTs ?? 0
  const maxTs = selected?.maxTs ?? 0
  const duration = Math.max(0, maxTs - minTs)

  const currentTs = playbackTs ?? minTs

  useEffect(() => {
    const cleanup = () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (!playing || !selected) {
      cleanup()
      return
    }
    const DEBUG = new URLSearchParams(window.location.search).has('debug')
    if (DEBUG) console.log('minTs:', minTs, 'maxTs:', maxTs, 'duration:', duration)

    const totalTicks = Math.max(PLAYBACK_MIN_TICKS, duration / PLAYBACK_DURATION_FACTOR)
    const baseStep = Math.max(1, Math.floor(duration / totalTicks))
    const step = Math.max(1, Math.floor(baseStep * playbackSpeed))
    cleanup()
    timerRef.current = window.setInterval(() => {
      setPlaybackTs((prev) => {
        const start = prev == null ? minTs : prev
        const next = start + step
        if (next >= maxTs) {
          setPlaying(false)
          return maxTs
        }
        return next
      })
    }, PLAYBACK_TICK_MS)
    return cleanup
  }, [playing, selected?.match_id, minTs, maxTs, duration, playbackSpeed])

  const heatModeForViewer: HeatmapMode | 'none' = heatmapMode === 'none' ? 'none' : heatmapMode

  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const filesInputRef = useRef<HTMLInputElement | null>(null)

  const openFolderPicker = () => {
    const el = folderInputRef.current
    if (!el) return
    el.value = ''
    el.click()
  }

  const openFilesPicker = () => {
    const el = filesInputRef.current
    if (!el) return
    el.value = ''
    el.click()
  }

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (pickingRef.current || loader.status === 'loading') return
    pickingRef.current = true
    setSelected(null)
    setEvents([])
    setPlaybackTs(null)
    setPlaying(false)
    setMatchQuery('')
    setDayFilter('All')
    setLookupQuery('')
    setLookupResult(null)
    setLookupStatus('idle')
    setLookupError(null)
    try {
      await loader.loadFiles(files, { mode: 'replace' })
    } finally {
      pickingRef.current = false
    }
  }

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(true)
    },
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.currentTarget === e.target) setIsDragOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      if (e.dataTransfer.files && e.dataTransfer.files.length) onPick(e.dataTransfer.files)
    },
  }

  const runLookup = async () => {
    const q = lookupQuery.trim()
    if (!q) return
    setLookupStatus('loading')
    setLookupError(null)
    try {
      if (looksLikeMatchId(q)) {
        const rows = await loader.lookupByMatchPrefix(q)
        setLookupResult({ kind: 'match', prefix: q, rows })
      } else {
        const rows = await loader.lookupByUserId(q)
        setLookupResult({ kind: 'user', userId: q, rows })
      }
      setLookupStatus('ready')
    } catch (e: any) {
      setLookupStatus('error')
      setLookupError(e?.message ? String(e.message) : 'Lookup failed.')
    }
  }

  const handleMatchListKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (matchesForMap.length === 0) return
    let nextIndex = currentIndex
    if (e.key === 'ArrowDown') nextIndex = Math.min(matchesForMap.length - 1, currentIndex + 1)
    else if (e.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1)
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = matchesForMap.length - 1
    else return

    e.preventDefault()
    const nextMatch = matchesForMap[nextIndex]
    if (!nextMatch) return
    setSelected(nextMatch)
    const button = document.querySelector<HTMLButtonElement>(`button[data-match-id="${CSS.escape(nextMatch.match_id)}"]`)
    button?.focus()
  }

  return (
    <div className="app" aria-busy={loader.status === 'loading' || eventsStatus === 'loading'}>
      <div className="sidebar">
        <input
          ref={folderInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          // @ts-expect-error - non-standard but supported in Chromium-based browsers
          webkitdirectory=""
          onChange={(e) => onPick(e.target.files)}
        />
        <input
          ref={filesInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => onPick(e.target.files)}
        />

        <div className="logo">
          <div className="logoMark">{'\u25C8'}</div>
          <div className="logoText">LILA VIZ</div>
        </div>

        {(loader.status === 'idle' || loader.status === 'error') && (
          <div>
            <div className="sectionTitle">LOAD PARQUET FILES</div>
            <div
              className={`dropzone ${isDragOver ? 'dropzoneActive' : ''}`}
              {...dropHandlers}
              aria-label="Upload parquet files by dropping folders or files here"
            >
              <div className="dropzoneLead">
                Select the `player_data/` folder to load all 5 days, or select individual day folders
                (February_10, February_11, etc).
              </div>
              <div className="muted">
                Tip: use directory-select if your file picker supports it. Loading happens fully in your
                browser via DuckDB-WASM.
              </div>
              <div className="buttonRow">
                <button
                  className="btn btnBlock"
                  type="button"
                  onClick={openFolderPicker}
                  aria-label="Select a folder of parquet files"
                >
                  Select Folder
                </button>
                <button
                  className="btn btnBlock"
                  type="button"
                  onClick={openFilesPicker}
                  aria-label="Select parquet files"
                >
                  Select Files
                </button>
              </div>
              {loader.error && <div className="errorText" role="alert">{loader.error}</div>}
            </div>
          </div>
        )}

        {loader.status === 'loading' && (
          <div className="card" role="status" aria-live="polite">
            <div className="sectionTitle">LOADING</div>
            <div className="muted progressLabel">
              {loader.progress.loaded.toLocaleString()} / {loader.progress.total.toLocaleString()} files
              {' \u2022 '} {formatBytes(loader.loadedBytes)}
            </div>
            <div className="progressOuter">
              <div
                className="progressInner"
                style={{
                  width: `${Math.floor(
                    (loader.progress.loaded / Math.max(1, loader.progress.total)) * 100,
                  )}%`,
                }}
              />
            </div>
            <div className="muted topGapSm">
              COOP/COEP must be enabled (this app sets the headers in dev + Vercel).
            </div>
          </div>
        )}

        {loader.status === 'ready' && (
          <>
            <div className="card">
              <div className="sectionTitle">MAP</div>
              <div className="tabs">
                {(['AmbroseValley', 'GrandRift', 'Lockdown'] as MapId[]).map((m) => (
                  <button
                    key={m}
                    className={`tab ${mapId === m ? 'tabActive' : ''}`}
                    onClick={() => setMapId(m)}
                  >
                    {m === 'AmbroseValley' ? 'Ambrose' : m === 'GrandRift' ? 'Rift' : 'Lockdown'}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="sectionTitle">MATCHES</div>
              <input
                className="input"
                placeholder="Search match id..."
                aria-label="Search match ID"
                value={matchQuery}
                onChange={(e) => setMatchQuery(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <select
                className="input"
                aria-label="Filter matches by date"
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value)}
                style={{ marginBottom: 10 }}
              >
                <option value="All">All dates</option>
                {daysForMap.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <div className="matchList" role="list" aria-label="Available matches">
                {matchesForMap.length === 0 && (
                  <div className="muted">No matches found for this map.</div>
                )}
                {matchesForMap.map((m, index) => {
                  const active = selected?.match_id === m.match_id
                  const dur = Math.max(0, m.maxTs - m.minTs)
                  return (
                    <button
                      key={m.match_id}
                      type="button"
                      data-match-id={m.match_id}
                      className={`matchItem ${active ? 'matchActive' : ''}`}
                      onClick={() => setSelected(m)}
                      onKeyDown={(e) => handleMatchListKeyDown(e, index)}
                      aria-pressed={active}
                      aria-label={`Select match ${m.match_id}, duration ${formatMs(dur)}, ${m.humanCount} humans, ${m.botCount} bots, ${m.eventCount} events`}
                    >
                      <div className="matchTopRow">
                        <div className="matchId" title={m.match_id}>
                          {m.match_id}
                        </div>
                        <div className="pill">{formatMs(dur)}</div>
                      </div>
                      <div className="pillRow">
                        <span className="pill">H {m.humanCount}</span>
                        <span className="pill">B {m.botCount}</span>
                        <span className="pill">{m.eventCount.toLocaleString()} ev</span>
                        <span className="pill">{m.day ?? 'Unknown'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="card">
              <div className="sectionTitle">LAYERS</div>
              <div className="grid2x2">
                <label className="toggle">
                  <input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} />
                  <span>Paths</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} />
                  <span>Events</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={showHumans} onChange={(e) => setShowHumans(e.target.checked)} />
                  <span>Humans</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={showBots} onChange={(e) => setShowBots(e.target.checked)} />
                  <span>Bots</span>
                </label>
              </div>
            </div>

            <div className="card">
              <div className="sectionTitle">HEATMAP</div>
              <select
                className="input"
                value={heatmapMode}
                onChange={(e) => setHeatmapMode(e.target.value as HeatmapUiMode)}
              >
                <option value="none">None</option>
                <option value="traffic">Traffic</option>
                <option value="kills">Kill Zones</option>
                <option value="deaths">Death Zones</option>
                <option value="loot">Loot Areas</option>
                <option value="storm">Storm Deaths</option>
              </select>
              <div className="sliderGrid">
                <label className="muted sliderField">
                  <span className="sliderLabel">
                    <span>Radius</span>
                    <span>{heatmapRadius}</span>
                  </span>
                  <input
                    type="range"
                    min={6}
                    max={40}
                    value={heatmapRadius}
                    aria-label="Heatmap radius"
                    aria-valuetext={`${heatmapRadius}`}
                    onChange={(e) => setHeatmapRadius(Number(e.target.value))}
                  />
                </label>
                <label className="muted sliderField">
                  <span className="sliderLabel">
                    <span>Opacity</span>
                    <span>{Math.round(heatmapOpacity * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={heatmapOpacity}
                    aria-label="Heatmap opacity"
                    aria-valuetext={`${Math.round(heatmapOpacity * 100)} percent`}
                    onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
                  />
                </label>
              </div>
            </div>

            <div className="card">
              <div className="sectionTitle">PLAYER LOOKUP</div>
              <div className="lookupControls">
                <input
                  className="input"
                  type="text"
                  placeholder="Enter player ID or match ID..."
                  aria-label="Enter player ID or match ID"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runLookup()
                  }}
                />
                <button
                  className="btn"
                  type="button"
                  onClick={runLookup}
                  disabled={lookupStatus === 'loading'}
                  aria-label="Search player or match"
                >
                  Search
                </button>
              </div>

              <div className="lookupActions">
                <button
                  className="btn btnBlock"
                  type="button"
                  aria-label="Clear search results"
                  onClick={() => {
                    setLookupQuery('')
                    setLookupResult(null)
                    setLookupStatus('idle')
                    setLookupError(null)
                  }}
                >
                  Clear
                </button>
              </div>

              {lookupError && <div className="errorText" role="alert">{lookupError}</div>}

              {lookupStatus === 'ready' && lookupResult && (
                <div className="muted topGapSm" role="status" aria-live="polite">
                  {lookupResult.kind === 'user'
                    ? `Showing up to ${LOOKUP_USER_RESULTS_LIMIT} matches for ${lookupResult.userId}.`
                    : `Showing up to ${LOOKUP_MATCH_RESULTS_LIMIT} players for match prefix ${lookupResult.prefix}.`}
                </div>
              )}

              {lookupResult && lookupResult.kind === 'user' && (
                <div className="lookupResults">
                  {(lookupResult.rows as any[]).slice(0, LOOKUP_USER_RESULTS_LIMIT).map((r, idx) => {
                    const dur = Math.max(0, Number(r.maxTs) - Number(r.minTs))
                    const badgeClass = r.isBot ? 'badge badgeBot' : 'badge badgeHuman'
                    return (
                      <button
                        key={`${r.match_id}-${idx}`}
                        className="lookupRow"
                        type="button"
                        aria-label={`Open match ${r.match_id} on ${r.map_id}, duration ${formatMs(dur)}, ${Number(r.events).toLocaleString()} events`}
                        onClick={() => {
                          const ms = loader.matches.find((m) => m.match_id === r.match_id)
                          if (ms) {
                            setMapId(ms.map_id)
                            setSelected(ms)
                          }
                        }}
                      >
                        <div className="lookupLeft">
                          <span className={badgeClass}>{r.isBot ? 'BOT' : 'HUMAN'}</span>
                          <span className="lookupMain">{truncateId(r.match_id)}</span>
                        </div>
                        <div className="lookupRight">
                          <span className="pill">{String(r.map_id)}</span>
                          <span className="pill">{formatMs(dur)}</span>
                          <span className="pill">{Number(r.events).toLocaleString()} ev</span>
                        </div>
                      </button>
                    )
                  })}
                  {lookupResult.rows.length === 0 && (
                    <div className="muted">No player matches found. Try a different ID.</div>
                  )}
                </div>
              )}

              {lookupResult && lookupResult.kind === 'match' && (
                <div className="lookupResults">
                  {(lookupResult.rows as any[]).slice(0, LOOKUP_MATCH_RESULTS_LIMIT).map((r, idx) => {
                    const badgeClass = r.isBot ? 'badge badgeBot' : 'badge badgeHuman'
                    return (
                      <div key={`${r.user_id}-${idx}`} className="lookupRowStatic">
                        <div className="lookupLeft">
                          <span className={badgeClass}>{r.isBot ? 'BOT' : 'HUMAN'}</span>
                          <span
                            className="lookupMain"
                            style={{ color: r.isBot ? '#ffb020' : '#00b4ff' }}
                            title={r.user_id}
                          >
                            {truncateId(r.user_id, 22)}
                          </span>
                        </div>
                        <div className="lookupRight">
                          <span className="pill">{Number(r.events).toLocaleString()} ev</span>
                        </div>
                      </div>
                    )
                  })}
                  {lookupResult.rows.length === 0 && (
                    <div className="muted">No match results found. Try a longer or exact match ID.</div>
                  )}
                </div>
              )}
            </div>

            <div className="card">
              <div className="sectionTitle">SELECTED MATCH</div>
              {!selected && <div className="muted">Pick a match to show event breakdown.</div>}
              {selected && (
                <div className="selectedMatchChips">
                  {Object.entries(eventCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([k, v]) => (
                      <span key={k} className="pill">
                        {k} {v.toLocaleString()}
                      </span>
                    ))}
                </div>
              )}
            </div>

            <button
              className="btn btnBlock"
              type="button"
              aria-label="Load different parquet files"
              onClick={() => {
                setSelected(null)
                setEvents([])
                setPlaybackTs(null)
                setPlaying(false)
                setMatchQuery('')
                setDayFilter('All')
                openFolderPicker()
              }}
            >
              Load Different Files
            </button>

            <button className="btn btnBlock" type="button" onClick={openFilesPicker} aria-label="Select parquet files">
              Select Files
            </button>
          </>
        )}
      </div>

      <div className="main">
        <div className="mainHeader">
          <div className="mainTitle">
            <h1>{MAP_CONFIGS[mapId].label}</h1>
            <div className="sub">
              {selected
                ? `${selected.match_id} \u2022 H ${selected.humanCount} \u2022 B ${selected.botCount} \u2022 ${events.length.toLocaleString()} events`
                : loader.status === 'ready'
                  ? `${matchesForMap.length.toLocaleString()} matches loaded`
                  : 'Load parquet files to begin'}
              {eventsStatus === 'error' && eventsError ? ` \u2022 ${eventsError}` : ''}
            </div>
          </div>

          <div className="controls">
            <button
              className={`btn ${playing ? 'btnAccent' : ''}`}
              disabled={!selected || eventsStatus !== 'ready'}
              aria-label={playing ? 'Pause playback' : 'Start playback'}
              onClick={() => {
                if (!selected) return
                if (!playing && playbackTs == null) setPlaybackTs(minTs)
                setPlaying((p) => !p)
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <select
              className="input speedSelect"
              disabled={!selected || eventsStatus !== 'ready'}
              value={String(playbackSpeed)}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              aria-label="Playback speed"
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
            </select>
            <button
              className="btn"
              disabled={!selected || eventsStatus !== 'ready'}
              aria-label="Reset playback to start"
              onClick={() => {
                if (!selected) return
                setPlaying(false)
                setPlaybackTs(minTs)
              }}
            >
              Reset
            </button>
            <input
              className="slider"
              type="range"
              min={minTs}
              max={maxTs}
              step={Math.max(1, Math.floor(duration / 800))}
              disabled={!selected || eventsStatus !== 'ready'}
              value={currentTs}
              aria-label="Playback timeline"
              aria-valuetext={
                selected ? `${formatMs(Math.max(0, currentTs - minTs))} of ${formatMs(duration)}` : 'No match selected'
              }
              onChange={(e) => {
                setPlaying(false)
                setPlaybackTs(Number(e.target.value))
              }}
            />
            <div className="muted timeReadout">
              {selected
                ? playbackTs == null
                  ? `--:-- / ${formatMs(duration)}`
                  : `${formatMs(Math.max(0, currentTs - minTs))} / ${formatMs(duration)}`
                : '--:-- / --:--'}
            </div>
          </div>
        </div>

        <div className="mapWrap">
          {selected && eventsStatus === 'ready' && (
            <MapViewer
              mapId={mapId}
              events={events}
              heatmapMode={heatModeForViewer}
              heatmapRadius={heatmapRadius}
              heatmapOpacity={heatmapOpacity}
              showPaths={showPaths}
              showEvents={showEvents}
              showHumans={showHumans}
              showBots={showBots}
              playbackTs={playbackTs}
            />
          )}
          {selected && eventsStatus === 'loading' && (
            <div className="card panelCard" role="status" aria-live="polite">
              <div className="sectionTitle">LOADING MATCH</div>
              <div className="muted">Querying events and preparing layers...</div>
            </div>
          )}
          {(!selected || eventsStatus === 'error') && (
            <div className="card panelCard">
              <div className="sectionTitle">READY WHEN YOU ARE</div>
              <div className="muted">
                {loader.status === 'ready'
                  ? 'Select a match from the sidebar to render paths, markers, and heatmaps.'
                  : 'Load parquet files using the sidebar. DuckDB runs fully in-browser; no backend needed.'}
              </div>
              {eventsStatus === 'error' && eventsError && <div className="errorText" role="alert">{eventsError}</div>}
            </div>
          )}
        </div>

        <div className="legendBar">
          <span className="chip">
            <span style={{ color: 'rgba(255,50,50,0.95)' }}>✕</span> Kill
          </span>
          <span className="chip">
            <span style={{ color: 'rgba(180,0,255,0.95)' }}>☠</span> Death
          </span>
          <span className="chip">
            <span style={{ color: 'rgba(255,120,0,0.95)' }}>⚡</span> Storm
          </span>
          <span className="chip">
            <span style={{ color: 'rgba(255,200,0,0.95)' }}>◆</span> Loot
          </span>
          <span className="chip">
            <span style={{ color: '#bcbcd1' }}>•</span> Playback dot
          </span>
        </div>
      </div>
    </div>
  )
}
