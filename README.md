# LILA VIZ — Player Journey Visualization

**Live Link**: https://lila-viz-nine.vercel.app

A web-based dashboard for visualizing player telemetry data from **LILA BLACK**. Load parquet match data directly in your browser and analyze player paths, combat zones, loot distribution, and storm dynamics in real-time.

---

## 🎮 Features

- **Multi-Map Support**: Analyze 3 playable maps (Ambrose Valley, Grand Rift, Lockdown)
- **Player Paths**: Visualize individual player journeys with color-coded paths (humans vs bots)
- **Event Markers**: Mark kills, deaths, loots, and storm-related events on the minimap
- **Heatmap Overlays**: 5 heatmap modes (traffic, kills, deaths, loot, storm deaths)
- **Timeline Playback**: Scrub through matches at variable speed (0.5x – 10x) with live position tracking
- **Player Lookup**: Search players or matches to find specific telemetry sessions
- **No Backend Required**: Fully client-side processing using DuckDB-WASM (works offline after loading)
- **Responsive Design**: Works on desktop and touch devices

---

## 📋 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 | UI framework with hooks |
| **Bundler** | Vite 5 | Fast build & HMR |
| **Language** | TypeScript 5 | Type safety |
| **Data Processing** | DuckDB-WASM | In-browser SQL queries on parquet |
| **Rendering** | Canvas API | 2D graphics (minimap + heatmap) |
| **Hosting** | Vercel | Static deployment with edge functions |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (LTS recommended)
- npm 9+ or yarn/pnpm

### Local Development

```bash
# Navigate to project
cd lila-viz

# Install dependencies
npm install

# Start dev server
npm run dev

# Open http://localhost:5173 in your browser
```

Data flow:
1. Click the upload area or drag-drop folders
2. Select `player_data/` or individual date folders (e.g., `February_10/`)
3. Wait for files to load into DuckDB (progress shown in sidebar)
4. Select a map, then pick a match from the list
5. Use playback controls to scrub through the match timeline

### Build & Preview

```bash
# Type check & build production bundle
npm run build

# Preview build locally
npm run preview
```

---

## 🌐 Deployment

### Deploy to Vercel (Recommended)

```bash
# Commit changes
git add .
git commit -m "Ready for production"

# Push to GitHub
git push origin main
```

Then:
1. Go to https://vercel.com
2. Click "New Project" → Select GitHub repository
3. Framework: `Vite` (auto-detected)
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Click Deploy

**Verification**: After deployment, check headers in browser DevTools:
```bash
curl -I https://lila-viz-nine.vercel.app

# Should show:
# Cross-Origin-Embedder-Policy: require-corp
# Cross-Origin-Opener-Policy: same-origin
```

---

## ⚙️ Environment Variables

**None required.** All data is loaded client-side from parquet files. No API keys, backend URLs, or environment vars needed.

---

## 📁 Project Structure

```
lila-viz/
├── src/
│   ├── App.tsx                    # Main component (filters, sidebar, controls)
│   ├── main.tsx                   # Entry point with ErrorBoundary
│   ├── styles.css                 # Global styles (dark theme)
│   ├── types/
│   │   └── index.ts               # MapId, EventType, MatchSummary types
│   ├── hooks/
│   │   └── useDataLoader.ts       # DuckDB initialization & SQL queries
│   ├── lib/
│   │   └── heatmap.ts             # Gaussian blur heatmap rendering
│   ├── components/
│   │   ├── MapViewer.tsx          # Canvas-based minimap + visualization
│   │   └── ErrorBoundary.tsx      # Error handler for render crashes
│   └── vite-env.d.ts              # Vite types
├── public/
│   ├── favicon.png
│   └── minimaps/                  # 1024×1024 map images
│       ├── AmbroseValley_Minimap.png
│       ├── GrandRift_Minimap.png
│       └── Lockdown_Minimap.jpg
├── index.html                     # HTML entry (favicon, fonts)
├── vite.config.ts                 # Vite config + COOP/COEP headers (dev)
├── vercel.json                    # Vercel config + security headers (prod)
├── tsconfig.json                  # TypeScript strict mode
├── package.json
└── .gitignore                     # Git ignore rules
```

**Key Files Explained**:
- `useDataLoader.ts`: Manages DuckDB worker lifecycle, file registration, and prepared SQL statements
- `MapViewer.tsx`: Triple-canvas rendering (minimap image, heatmap overlay, path/event layer)
- `heatmap.ts`: Gaussian kernel-based density visualization with adaptive resolution
- `ARCHITECTURE.md`: Deep dive on design decisions and coordinate mapping
- `INSIGHTS.md`: Level design analysis patterns (See next section)

---

## 🔒 COOP/COEP Headers Requirement

DuckDB-WASM uses `SharedArrayBuffer` for efficient data transfer between threads. Modern browsers require two HTTP headers to enable this:

- **`Cross-Origin-Embedder-Policy: require-corp`** — Requires all subresources (fonts, images) to declare they're embeddable
- **`Cross-Origin-Opener-Policy: same-origin`** — Restricts window.opener access for security

These are automatically set in:
- **Development**: `vite.config.ts` (dev server headers)
- **Production**: `vercel.json` (Vercel Edge Functions)

If you see browser errors about `SharedArrayBuffer`, verify these headers are present in the response.

---

## 📊 Data Format

Expect parquet files with these columns:
```
user_id:     String (player identifier)
match_id:    String (unique match session)
map_id:      String ("AmbroseValley", "GrandRift", or "Lockdown")
x, y, z:     Float64 (world coordinates, y=elevation)
ts:          Int64 (match-elapsed time in ms)
event:       String ("Position", "BotPosition", "Kill", "Killed", 
                      "BotKill", "BotKilled", "Loot", "KilledByStorm")
isBot:       Boolean (derived from filename or column)
day:         String (derived from folder path, e.g. "February_10")
```

**Bot Detection**: If no `isBot` column, derived from filename (all-numeric user ID = bot).

---

## 📖 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)**: Design decisions, coordinate mapping, COOP/COEP explanation
- **[INSIGHTS.md](./INSIGHTS.md)**: 3 level-design analysis patterns with concrete examples
- **[CODE_REVIEW.md](./CODE_REVIEW.md)**: Architecture & code quality audit

---

## 🤝 Contributing

Bug reports? Feature requests? Security issues?

- **Bugs**: Open a GitHub issue with reproduction steps
- **Security**: Report privately to maintainer (do not open public issue)
- **Features**: Discuss in an issue before starting work

---

## 📝 License

Part of the LILA BLACK APM assignment submission. Internal use only.

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| Files won't upload | Ensure browser supports directory upload (`webkitdirectory`). Use File → Select Folder. |
| Heatmaps not rendering | Check COOP/COEP headers: `curl -I https://your-url`. See [ARCHITECTURE.md](./ARCHITECTURE.md) for details. |
| Playback stutters | Close browser tabs to free memory. DuckDB-WASM may use 100+ MB for large datasets. |
| No matches loaded | Verify parquet files have `map_id` column with values matching map names (case-sensitive). |

---



