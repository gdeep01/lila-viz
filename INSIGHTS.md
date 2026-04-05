# LILA VIZ — Level Design Insights

**What to Extract from Player Telemetry**

Three high-signal patterns a level designer should hunt for using **LILA VIZ**. Each insight is **data-driven** — observable directly in the heatmap visualizations without speculation about player intent.

---

## Insight 1: Kill Efficiency Hotspots Reveal Hidden Power Positions

### 🎯 What to Look For

Toggle **Heatmap: Traffic** vs **Heatmap: Kill Zones** on the same match set.

**The Pattern**: A location lights up bright on Kill Zones but stays *dim* or invisible on Traffic. This is not a high-traffic corridor with many fights — it's a **high-conversion ambush zone** where a small number of encounters end lethally.

**Example**: On **Grand Rift**, the area around the **Mine Pit entrance** might show:
- Kill markers clustered tightly
- Minimal position/movement data nearby
- Players appear, fight ends, survivor moves on

### 📊 Concrete Evidence to Capture

Compute kill efficiency per grid cell (coarse grid, e.g., 64×64 pixels):

```
Efficiency = (Kills + BotKills) / max(1, Positions + BotPositions)
```

Look for cells with:
- **Kills ≥ 3** (signal is stable with a few occurrences)
- **Positions ≤ 50** (minimal traffic relative to kills)
- **Efficiency > 0.06** (>6% of visitors die there)

Use LILA VIZ's timeline scrubber to watch **multiple matches** and confirm the pattern repeats at the same location.

### ✏️ Actionable Design Changes

If this is **unintended** (no designed advantage there):
1. **Add cover for approached players**: Break line-of-sight between the ambusher and entry approaches. Add objects, walls, or elevation breaks.
2. **Create alternate routes**: If players *must* pass through this choke to rotate, add high-risk flanking paths or vertical movement options (vaults, ropes).
3. **Reduce sight lines**: Tall vegetation, fog, or ambient noise can make early detection harder (reducing power of the ambush).

If this **is intended** (a power position):
1. **Add counterplay**: More entrances, wider approach angles, or temporary cover (crates, doors) that appear/disappear.
2. **Balance with risk**: Increase proximity to storm edge, reduce nearby loot, or make position more exposed to third-party fights.

### 💭 Why a Level Designer Cares

Raw kill counts are noisy — high-traffic zones accumulate kills naturally. **Kill efficiency isolates repeated one-sided engagements**, flagging where map geometry consistently favors one player over others. This is where fairness breakdowns and "bullying zones" form. Players learn these spots and camp them, making rotations painful for others.

### 🔍 How to Validate in LILA VIZ

1. Set **Heatmap: Traffic** on 5+ matches, note congested routes
2. Identify moderate-traffic corridors (not the busiest, not empty)
3. Switch to **Heatmap: Kill Zones** — do kills cluster at the same spot?
4. Scrub playback on 2-3 matches: Do you see repeated ambush patterns?
5. **Note zone name** and take screenshot for design review

---

## Insight 2: Storm Death Clustering Flags Rotation Punishment

### 🎯 What to Look For

Set **Heatmap: Storm Deaths** (⚡ icon) and scrub through **several matches**.

**The Pattern**: Storm death markers cluster **persistently** along one map edge or corridor (not random). This means players are repeatedly caught in the same bad rotation, suggesting either:
- Poor visibility of storm direction/speed
- Geometry forces a difficult late-game route
- Ring placement progression creates a "squeeze pattern"

**Example**: On **Ambrose Valley**, watch if **KilledByStorm** events concentrate along the southeast edge. In multiple matches, deaths repeat at the same location. Players aren't dying randomly — they're dying in a corridor where geometry + storm timing collide.

### 📊 Concrete Evidence to Capture

Using the heatmap visualization:
1. **Count where storm deaths occur** relative to map edges
   - Note if they're spread randomly → healthy rotation system
   - Note if concentrated on one edge/corridor → design issue
2. **Compare to previous rings**: Are deaths worse in later stages?
3. **Check distance from safe zone**: Are players getting caught <200 units from "safety"?

Use the timeline to find the **temporal pattern**: Do deaths spike at a specific game duration (e.g., always 8-10 minutes in)? That suggests ring timing, not rotation options.

### ✏️ Actionable Design Changes

If storm deaths cluster in one area:
1. **Add telegraphing**: Earlier audio/visual storm warnings, clearer direction arrows, or screen-edge glow as storm approaches.
2. **Create rotation escapes**: Add ziplines, tunnels, gate shortcuts, or sprint pads leading OUT of the danger zone.
3. **Adjust ring timing**: Widen the safe zone earlier OR slow the ring advancement initially (gives players warning time).
4. **Break sightlines to next zone**: If players can't *see* where the next zone is, they camp and die. Add tall landmarks pointing toward rotation routes.

If deaths are random/spread:
- No change needed — rotation system is working

### 💭 Why a Level Designer Cares

Storm deaths look like "RNG punishment," but they're usually **map design failures**. Good rotations let players escape late zones through skill or speed. Repeated clustering means the geometry or progression betrayed player agency. This erodes trust in the game's fairness.

### 🔍 How to Validate in LILA VIZ

1. Set **Heatmap: Storm Deaths** on 10+ matches
2. Scrub through each match and **note where deaths appear** (map zones or edges)
3. Do you see the same locations across 3+ matches?
4. Open **Timeline** and note match duration when deaths happen
5. **Repeat for different maps** — each has different rotation patterns

---

## Insight 3: Loot vs. Traffic Mismatch Reveals Reward Structure Breaks

### 🎯 What to Look For

**Overlay** two heatmaps on the same match set:
1. **Heatmap: Traffic** (blue, busy routes)
2. **Heatmap: Loot** (yellow, treasure locations)

**The Pattern**: A high-traffic corridor shows *little to no* loot markers, while nearby, an isolated corner glows with loot but almost no players pass through.

**Examples**:
- **Grand Rift Central Hub**: High traffic, but loot markers are dim → players are transiting, not looting
- **Lockdown Maintenance Bay**: Loot markers appear on Loot heatmap, but only faint movement → treasure is there but risky/hidden to find

### 📊 Concrete Evidence to Capture

Compute loot density per named zone:

```
Loot Reward Ratio = Loots / Positions (per zone)
```

Rank zones by reward ratio:

| Zone | Loots | Positions | Ratio | Issue |
|------|-------|-----------|-------|-------|
| Mine Pit (GrandRift) | 5 | 300 | 0.017 | Dead exploration — players pass through without reward |
| Engineer's Quarters | 8 | 50 | 0.16 | High value — risky but rewarding |
| Gas Station | 1 | 200 | 0.005 | Low reward — poor rotation incentive |

**Look for**:
- **Ratio < 0.01** on high-traffic zones → "Loot-starved transit corridors"
- **Ratio > 0.12** on low-traffic zones → "Hidden treasures" (intended or not?)

Use the scrubber to watch players: Do they **search the ground** without finding loot, or do they walk past loot they didn't see?

### ✏️ Actionable Design Changes

For **high-traffic, low-loot zones** ("dead exploration"):
1. **Add loot spawns** to reward routing through that area — makes it a viable destination, not just a corridor.
2. **Add visual affordances**: Highlighted containers, glow effects, or audio cues to make loot findable.
3. **Reduce friction**: Remove doors, long ladders, or hidden chests that bury rewards.

For **low-traffic, high-loot zones** (hidden treasures):
1. If **intentional** (secret stash): Add **subtle landmarks** guiding players there (distinctive building, audio loop, ground decals).
2. If **accidental** (loot spawn bug): Move spawns to higher-traffic area or reduce quantity.
3. Add **risk payoff**: If loot is hard to reach, it *should* offer high-tier rewards to justify the detour.

For **balanced zones** (consistent ratio):
- No change needed — reward gradient is healthy

### 💭 Why a Level Designer Cares

**Players vote with their feet.** High traffic proves players *want* to move through an area. But if they get nothing — no loot, no fights, no cover — that zone becomes a chore. Conversely, treasure buried in dead zones teaches players that exploration isn't rewarded. Misaligned reward gradients make players feel like loot is random, not because of smart location choice.

### 🔍 How to Validate in LILA VIZ

1. Set **Heatmap: Traffic** on 5+ matches, note congested routes
2. Switch to **Heatmap: Loot**, overlay mentally: Which traffic zones have loot? Which don't?
3. Toggle back and forth to confirm absence/presence
4. Use the **Player Lookup** to find 1-2 experienced players, scrub their journey:
   - Do they *pass through* high-traffic zones without looting?
   - Do they *seek* low-traffic zones deliberately?
5. Screenshot mismatches and note zone names for design review

---

## 🎮 Quick Data Collection Workflow

1. **Upload** 1-2 days of parquet data (smaller dataset = faster queries)
2. **Pick one map** (Grand Rift is most compact)
3. **Choose 5-10 popular matches** (sort match list by event count)
4. **Apply one insight pattern** (e.g., toggle Traffic vs. Kill Zones)
5. **Scrub playback** on matches to confirm pattern is real
6. **Screenshot** specific zones or locations
7. **Document findings** with zone names and metrics
8. **Build severity list** (which zones matter most?)

---

## 📌 Map Zone Reference

Use these zone names when documenting findings:

### Ambrose Valley
- Central Plaza
- Residential District
- Factory Zone
- Forest Edge
- River Crossing

### Grand Rift
- **Mine Pit entrance** (southeast cluster)
- **Cave House** (underground complex)
- Labour Quarters (barracks area)
- **Engineer's Quarters** (tech hub)
- Maintenance Bay (vehicle area)
- Burnt Zone (devastated area)
- Gas Station (fuel depot)

### Lockdown
- Command Center (core zone)
- Perimeter Fence
- Northern Bunker
- Southern Tower
- Central Courtyard
- Service Tunnels

---

**Recommendation**: Start with **Insight 1** (Kill Efficiency) on **Grand Rift**. It's the fastest pattern to spot and gives clear actionable feedback.
