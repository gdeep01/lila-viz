# LILA VIZ — Architecture

## Stack choices (and why)

- **React 18 + Vite + TypeScript**: fast local iteration, strong typing for data/visualization code, easy static deployment.
- **DuckDB-WASM (in-browser)**: loads raw parquet files directly with SQL (no backend), works offline after assets load, deploys cleanly on Vercel.
- **Canvas API (no Leaflet/tiles)**: minimaps are fixed 1024×1024 images; canvas gives full control for drawing paths, markers, and density overlays with minimal overhead.

## Data flow

1. **User selects / drag-drops parquet files**
2. **Browser reads each file into memory** (`File.arrayBuffer()`)
3. **DuckDB-WASM virtual FS**: each parquet is registered via `registerFileBuffer()`
4. **SQL ingest**: `INSERT INTO events SELECT ... FROM read_parquet(...)`
   - `event` is cast to `VARCHAR` (some files store it as binary)
   - `ts` is converted to numeric ms via `epoch_ms(ts)` (match-elapsed timeline math)
5. **Match discovery**: `GROUP BY match_id, map_id` builds `MatchSummary` for the sidebar
6. **React state** holds:
   - loaded matches
   - selected match’s events (queried on demand)
   - visualization toggles + heatmap mode
   - playback timestamp
7. **Canvas rendering** (three stacked canvases):
   - minimap image
   - heatmap overlay
   - paths + event markers + playback dots

## Coordinate mapping (world → minimap pixel)

The parquet stores `(x, y, z)` in world space where:
- **`y` is elevation** (ignored for 2D minimap rendering)
- **`x` is horizontal**, **`z` is vertical** in top-down view

For each map we use `(scale, originX, originZ)` and compute:

1. Normalize to UV (0..1-ish):
   - `u = (world_x - originX) / scale`
   - `v = (world_z - originZ) / scale`
2. Convert to minimap pixels (1024×1024):
   - `pixel_x = u * 1024`
   - `pixel_y = (1 - v) * 1024`

The **Y-axis is flipped** because image space starts at the top-left (increasing Y goes down),
while world Z typically increases “up” in a top-down view.

## Assumptions

- `ts` is stored as `datetime64[ms]` but represents **match-elapsed time**; the epoch offset is consistent within a match so **relative ordering and playback** work.
- Bot detection by filename is reliable: if the part before the first `_` is numeric, it’s a bot (per dataset README).
- February 14 is a partial day and is loaded as-is without special handling.

## Tradeoffs

| Decision | Chosen | Alternative | Reason |
|---|---|---|---|
| Data layer | DuckDB-WASM | Python FastAPI backend | No infra, instant Vercel deploy |
| Rendering | Canvas API | Leaflet/Mapbox | No tile system needed, full control |
| File loading | In-browser | Pre-processed static JSON | Works with raw parquet directly |
| Bot detection | Filename parse | Column check | Filename is authoritative per README |

## COOP/COEP requirement

DuckDB-WASM uses `SharedArrayBuffer`, which requires:
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`

These are set for:
- **Dev**: `lila-viz/vite.config.ts`
- **Prod (Vercel)**: `lila-viz/vercel.json`

