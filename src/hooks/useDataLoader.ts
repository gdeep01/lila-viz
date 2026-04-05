import { useCallback, useMemo, useRef, useState } from 'react'
import * as duckdb from '@duckdb/duckdb-wasm'
import type { MatchSummary, PlayerEvent } from '../types'

type LoaderStatus = 'idle' | 'loading' | 'ready' | 'error'

type DuckContext = {
  db: duckdb.AsyncDuckDB
  conn: duckdb.AsyncDuckDBConnection
  stmtEventsByMatch: duckdb.AsyncPreparedStatement
  stmtEventsByMatchMaxTs: duckdb.AsyncPreparedStatement
  stmtLookupByUser: duckdb.AsyncPreparedStatement
  stmtLookupByMatchPrefix: duckdb.AsyncPreparedStatement
}

let duckPromise: Promise<DuckContext> | null = null

function sanitizeVirtualFileName(name: string): string {
  const base = name.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_')
  const trimmed = base.length > 180 ? base.slice(base.length - 180) : base
  return trimmed.endsWith('.parquet') ? trimmed : `${trimmed}.parquet`
}

function sanitizeDayLabel(day: string): string {
  const cleaned = day.replace(/[^a-zA-Z0-9_]/g, '_')
  const trimmed = cleaned.slice(0, 32)
  return trimmed || 'Unknown'
}

function isBotFromFileName(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name
  const userId = base.split('_')[0] ?? ''
  return /^\d+$/.test(userId)
}

function dayFromPath(name: string): string | null {
  // Prefer the first folder segment (works with webkitRelativePath).
  const firstDir = name.split(/[\\/]/)[0]
  if (firstDir && /^[A-Za-z]+_\d{1,2}$/.test(firstDir)) return firstDir
  // Fallback: find Month_DD anywhere in the path.
  const m = name.match(/(?:^|[\\/])([A-Za-z]+_\d{1,2})(?:[\\/]|$)/)
  return m?.[1] ?? null
}

function looksLikeParquet(buffer: Uint8Array): boolean {
  if (buffer.byteLength < 8) return false
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x41 &&
    buffer[2] === 0x52 &&
    buffer[3] === 0x31 &&
    buffer[buffer.length - 4] === 0x50 &&
    buffer[buffer.length - 3] === 0x41 &&
    buffer[buffer.length - 2] === 0x52 &&
    buffer[buffer.length - 1] === 0x31
  )
}

async function getDuck(): Promise<DuckContext> {
  if (!duckPromise) {
    duckPromise = (async () => {
      try {
        const bundles = duckdb.getJsDelivrBundles()
        const bundle = await duckdb.selectBundle(bundles)
        if (!bundle.mainWorker || !bundle.mainModule) {
          throw new Error('DuckDB bundle selection failed (missing worker/module).')
        }

        const workerUrl = URL.createObjectURL(
          new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }),
        )
        const worker = new Worker(workerUrl)
        const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
        const db = new duckdb.AsyncDuckDB(logger, worker)
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
        URL.revokeObjectURL(workerUrl)
        const conn = await db.connect()

        await conn.query(`
          CREATE TABLE IF NOT EXISTS events (
            user_id VARCHAR,
            match_id VARCHAR,
            map_id VARCHAR,
            x DOUBLE,
            y DOUBLE,
            z DOUBLE,
            ts BIGINT,
            event VARCHAR,
            isBot BOOLEAN,
            day VARCHAR
          );
        `)
        try {
          await conn.query(`CREATE INDEX IF NOT EXISTS idx_events_match_ts ON events(match_id, ts);`)
        } catch {
          // Index creation is optional; ignore if unsupported in this build.
        }

        const stmtEventsByMatch = await conn.prepare(`
          SELECT user_id, match_id, map_id, x, y, z, ts, event, isBot, day
          FROM events
          WHERE match_id = ?
          ORDER BY ts ASC;
        `)
        const stmtEventsByMatchMaxTs = await conn.prepare(`
          SELECT user_id, match_id, map_id, x, y, z, ts, event, isBot, day
          FROM events
          WHERE match_id = ? AND ts <= ?
          ORDER BY ts ASC;
        `)

        const stmtLookupByUser = await conn.prepare(`
          SELECT
            match_id,
            map_id,
            day,
            COUNT(*) AS events,
            MIN(ts) AS minTs,
            MAX(ts) AS maxTs,
            bool_or(isBot) AS isBot
          FROM events
          WHERE user_id = ?
          GROUP BY match_id, map_id, day
          ORDER BY (MAX(ts) - MIN(ts)) DESC, events DESC;
        `)

        const stmtLookupByMatchPrefix = await conn.prepare(`
          SELECT
            user_id,
            isBot,
            COUNT(*) AS events
          FROM events
          WHERE match_id LIKE ?
          GROUP BY user_id, isBot
          ORDER BY isBot, events DESC;
        `)

        return { db, conn, stmtEventsByMatch, stmtEventsByMatchMaxTs, stmtLookupByUser, stmtLookupByMatchPrefix }
      } catch (e) {
        // Allow retries if initialization fails.
        duckPromise = null
        throw e
      }
    })()
  }
  return duckPromise
}

function tableToObjects<T extends object>(table: unknown): T[] {
  // `apache-arrow` Table in practice; avoid importing types here.
  if (!table || typeof table !== 'object') return []
  const maybe = table as any
  if (typeof maybe.toArray !== 'function') return []
  try {
    const rows = maybe.toArray() as any[]
    return rows.map((row) => (row && typeof row.toJSON === 'function' ? row.toJSON() : row)) as T[]
  } catch (e) {
    console.error('DuckDB Arrow table conversion failed:', e)
    return []
  }
}

function toNumber(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v.toString())
  if (typeof v === 'string') return Number(v)
  if (typeof v === 'object' && (v as any).toString) return Number((v as any).toString())
  return Number(v as any)
}

export function useDataLoader() {
  const [status, setStatus] = useState<LoaderStatus>('idle')
  const [progress, setProgress] = useState({ loaded: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<MatchSummary[]>([])
  const [loadedBytes, setLoadedBytes] = useState<number>(0)

  const bytesRef = useRef(0)
  const loadedVirtualNamesRef = useRef<Set<string>>(new Set())

  const loadFiles = useCallback(async (filesInput: File[] | FileList, opts?: { mode?: 'replace' | 'append' }) => {
    const files = Array.from(filesInput)
    if (files.length === 0) return
    const mode = opts?.mode ?? 'replace'

    const MAX_FILE_BYTES = 1024 * 1024 * 1024 // 1GB
    const MAX_TOTAL_BYTES = 12 * 1024 * 1024 * 1024 // 12GB
    let total = 0
    for (const f of files) {
      total += f.size
      if (f.size > MAX_FILE_BYTES) {
        throw new Error(`File too large: ${f.name} (${Math.round(f.size / (1024 * 1024))} MB)`)
      }
    }
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`Total selection too large: ${Math.round(total / (1024 * 1024 * 1024))} GB`)
    }

    setStatus('loading')
    setError(null)
    setLoadedBytes(0)
    bytesRef.current = 0
    setProgress({ loaded: 0, total: files.length })

    const { db, conn } = await getDuck()

    if (mode === 'replace') {
      await conn.query(`DELETE FROM events;`)
      loadedVirtualNamesRef.current = new Set()
      setMatches([])
    }

    const batchSize = 20
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      await conn.query('BEGIN TRANSACTION;')
      try {
        for (const file of batch) {
          const rel = (file as any).webkitRelativePath || file.name
          const virtualName = sanitizeVirtualFileName(rel)
          if (mode === 'append' && loadedVirtualNamesRef.current.has(virtualName)) {
            setProgress((p) => ({ ...p, loaded: p.loaded + 1 }))
            continue
          }
          const isBot = isBotFromFileName(rel)
          const day = sanitizeDayLabel(dayFromPath(rel) ?? 'Unknown')
          const buffer = new Uint8Array(await file.arrayBuffer())
          if (!looksLikeParquet(buffer)) {
            setProgress((p) => ({ ...p, loaded: p.loaded + 1 }))
            continue
          }

          bytesRef.current += buffer.byteLength
          setLoadedBytes(bytesRef.current)

          await db.registerFileBuffer(virtualName, buffer)
          await conn.query(`
            INSERT INTO events
            SELECT
              user_id::VARCHAR AS user_id,
              match_id::VARCHAR AS match_id,
              map_id::VARCHAR AS map_id,
              x::DOUBLE AS x,
              y::DOUBLE AS y,
              z::DOUBLE AS z,
              (epoch_ms(ts) / 1000)::BIGINT AS ts,
              event::VARCHAR AS event,
              ${isBot ? 'TRUE' : 'FALSE'} AS isBot,
              '${day}' AS day
            FROM read_parquet('${virtualName}');
          `)
          try {
            await db.dropFile(virtualName)
          } catch {
            // Best-effort: dropping file buffers reduces memory pressure.
          }
          loadedVirtualNamesRef.current.add(virtualName)

          setProgress((p) => ({ ...p, loaded: p.loaded + 1 }))
        }
        await conn.query('COMMIT;')
      } catch (e) {
        try {
          await conn.query('ROLLBACK;')
        } catch {
          // ignore
        }
        throw e
      }
    }

    const res = await conn.query(`
      SELECT
        match_id,
        map_id,
        day,
        COUNT(DISTINCT CASE WHEN NOT isBot THEN user_id END) AS humanCount,
        COUNT(DISTINCT CASE WHEN isBot THEN user_id END) AS botCount,
        COUNT(*) AS eventCount,
        MIN(ts) AS minTs,
        MAX(ts) AS maxTs
      FROM events
      WHERE ts IS NOT NULL
      GROUP BY match_id, map_id, day
      ORDER BY (MAX(ts) - MIN(ts)) DESC, eventCount DESC;
    `)

    const raw = tableToObjects<any>(res)
    const parsed: MatchSummary[] = raw
      .map((r) => ({
        match_id: String(r.match_id),
        map_id: String(r.map_id) as any,
        day: r.day != null ? String(r.day) : undefined,
        humanCount: Number(r.humanCount ?? 0),
        botCount: Number(r.botCount ?? 0),
        eventCount: Number(r.eventCount ?? 0),
        minTs: Number(r.minTs?.toString() ?? '0'),
        maxTs: Number(r.maxTs?.toString() ?? '0'),
      }))
      .filter((m) => m.map_id === 'AmbroseValley' || m.map_id === 'GrandRift' || m.map_id === 'Lockdown')

    setMatches(parsed)
    setStatus('ready')
  }, [])

  const queryEvents = useCallback(async (matchId: string, maxTs?: number) => {
    const { stmtEventsByMatch, stmtEventsByMatchMaxTs } = await getDuck()
    const res =
      maxTs != null
        ? await stmtEventsByMatchMaxTs.query(matchId, Math.floor(maxTs))
        : await stmtEventsByMatch.query(matchId)
    const rows = tableToObjects<any>(res)
    return rows.map(
      (r): PlayerEvent => ({
        user_id: String(r.user_id),
        match_id: String(r.match_id),
        map_id: String(r.map_id) as any,
        x: Number(r.x),
        y: Number(r.y),
        z: Number(r.z),
        ts: Number(r.ts?.toString() ?? '0'),
        event: String(r.event) as any,
        isBot: Boolean(r.isBot),
        day: r.day != null ? String(r.day) : undefined,
      }),
    )
  }, [])

  const lookupByUserId = useCallback(async (userId: string) => {
    const { stmtLookupByUser } = await getDuck()
    const res = await stmtLookupByUser.query(userId)
    const rows = tableToObjects<any>(res)
    return rows.map((r) => ({
      match_id: String(r.match_id),
      map_id: String(r.map_id),
      day: r.day != null ? String(r.day) : 'Unknown',
      events: Number(r.events ?? 0),
      minTs: Number(r.minTs?.toString() ?? '0'),
      maxTs: Number(r.maxTs?.toString() ?? '0'),
      isBot: Boolean(r.isBot),
    }))
  }, [])

  const lookupByMatchPrefix = useCallback(async (prefix: string) => {
    const { stmtLookupByMatchPrefix } = await getDuck()
    const like = `${prefix}%`
    const res = await stmtLookupByMatchPrefix.query(like)
    const rows = tableToObjects<any>(res)
    return rows.map((r) => ({
      user_id: String(r.user_id),
      isBot: Boolean(r.isBot),
      events: Number(r.events ?? 0),
    }))
  }, [])

  const api = useMemo(
    () => ({
      status,
      progress,
      loadedBytes,
      error,
      matches,
      loadFiles: async (files: File[] | FileList, opts?: { mode?: 'replace' | 'append' }) => {
        try {
          await loadFiles(files, opts)
        } catch (e: any) {
          setStatus('error')
          setError(e?.message ? String(e.message) : 'Failed to load files.')
        }
      },
      queryEvents,
      lookupByUserId,
      lookupByMatchPrefix,
    }),
    [status, progress, loadedBytes, error, matches, loadFiles, queryEvents, lookupByUserId, lookupByMatchPrefix],
  )

  return api
}
