# Spec: Environment Density v2 ("office-v2")

## Goal
Make the procedurally generated office floorplate architecturally dense, layered, and
disorienting (backrooms-adjacent), while staying mundane and corporate. Density serves
disorientation: short sightlines, hideable structure in every zone, no large clear areas
except brief transitions. No debris/ruins aesthetics — only anonymous architecture.

## Non-goals
- No new art assets, no lighting model changes, no shadow maps.
- No changes to enemy AI logic, networking, or player movement values.
- Do not break determinism: identical seed => identical maze + hash on all clients.

## Files to modify
- `src/shared/config.ts` — new tuning knobs.
- `src/maze/generateMaze.ts` — all generator work; bump `generatorVersion` to `"office-v2"`.
- `src/simulation/collision.ts` — spatial hash for features (perf).
- `src/enemy/updateEnemy.ts` — reuse spatial hash for LOS feature iteration (perf, optional but preferred).
- `src/rendering/GameRenderer.ts` — ceiling grid lattice + light panel changes.
- `src/maze/generateMaze.test.ts` — update thresholds, add new invariant tests.

All randomness MUST come from the existing seeded `random()` (`createRandom(seed)`),
called in a fixed order. Never use `Math.random()`.

---

## 1. Config changes (`src/shared/config.ts`)

Update `maze` section:

```ts
maze: {
  width: 151,
  height: 151,
  cellSize: 2,
  wallHeight: 3.1,
  majorZones: 50,
  minimumZoneCells: 8,          // was 9 — slightly smaller rooms allowed
  connectorWidthCells: 3,        // now the MAX; actual width rolls 1..3 (see §5)
  partitionDensity: 0.85,        // was 0.68
  pillarDensity: 0.34,           // was 0.16
  pillarClusterChance: 0.55,     // NEW: chance a pillar seed becomes a cluster
  stubWallDensity: 0.7,          // NEW: per-zone chance budget for wall-attached stubs
  alcoveDensity: 0.45,           // NEW: per-partition chance of carving an alcove
  doorJogChance: 0.5,            // NEW: chance an opening gets a baffle wall
  bonusConnectorChance: 0.35,    // NEW: extra narrow punch-through per partition
  ceilingJitter: 0.45,           // NEW: max per-zone ceiling grid offset, in cells
  openness: 0.62,
  occlusion: 0.68,
  repetition: 0.72,
  spawnSeparationMeters: 90,
},
```

---

## 2. Clustered, irregular support columns (`generateMaze.ts`)

Replace the current per-zone grid-spaced pillar candidate loop with cluster seeding:

1. Per zone, compute `seedBudget = floor(zone.width * zone.height * pillarDensity / 55)`,
   min 1 for zones with area >= 48.
2. For each seed: pick a random interior cell `(x, z)` with `zone.x+1 < x < zone.x+zone.width-2`
   (same for z). Skip if cell already closed.
3. Place the seed pillar. Then if `random() < pillarClusterChance`, place `1 + floor(random()*3)`
   additional pillars at offsets drawn from
   `[(1,0),(0,1),(-1,0),(0,-1),(1,1),(-1,1),(2,0),(0,2)]` (pick via `random()`, skip
   out-of-zone / already-closed cells). Clusters of 2–4 columns, irregular shapes.
4. Pillar footprint varies: `width = depth = 0.55 + random() * 0.4` (in cell units, like
   current 0.7). With probability 0.2, make it rectangular ("furred" column):
   `width = 0.5 + random()*0.3`, `depth = 0.9 + random()*0.5` (or swapped axes via random()).
   A rectangular pillar still only closes its single host cell.
5. Closing a cell: `cells[idx] = 0` exactly as today. Feature kind stays `"pillar"`,
   `height = wallHeight`, `blocksSight: true`, centered at `x + 0.5, z + 0.5`.

Do NOT enforce grid spacing or per-zone uniform offsets anymore. Delete the old
`pillarSpacing/pillarOffsetX/pillarOffsetZ` candidate logic.

## 3. Wall-attached partition stubs

New per-zone pass, run after the BSP splits and before pillars:

1. `stubBudget = 1 + floor(zone.area / 120)`, capped at 4.
2. For each stub, if `random() < stubWallDensity`:
   - Pick an edge of the zone (N/E/S/W via `floor(random()*4)`).
   - Attach point: jittered along that edge, at least 2 cells from zone corners.
   - Length: `max(2, floor(perpendicularDimension * (0.25 + random()*0.2)))`,
     clamped so it leaves >= 3 open cells of clearance to the opposite zone edge
     (never fully closes the room — these are stubs, not splits).
   - Kind: `"wall"` (full height, blocksSight) with probability 0.6, else `"divider"`.
   - Emit via the existing `addVerticalPartition` / `addHorizontalPartition` helpers with
     NO openings (`openingStart = -1`), starting flush at the zone boundary cell so it
     visually joins the wall.

## 4. Alcoves and shallow recesses

Modify `addVerticalPartition` / `addHorizontalPartition` (or wrap them) so that when a
BSP split wall is placed, with probability `alcoveDensity` ONE alcove is carved into it:

1. Pick alcove span: width 2–3 cells along the wall, not overlapping any opening
   (primary, secondary, or bonus) and at least 2 cells from the wall's ends. If no valid
   span exists, skip silently.
2. Pick depth `d`: 1 (shallow, barely noticeable) with probability 0.6, else 2 (deep
   enough to hide in). Pick the side it recesses into via `random()` (must have >= d+2
   cells of room on that side; otherwise use the other side; if neither, skip).
3. Geometry: instead of the straight wall segment across the span, emit:
   - a back wall segment offset `d` cells into the chosen side, spanning the alcove width,
   - two return wall segments of length `d` connecting back wall ends to the main wall line.
   All three are kind `"wall"`, `width/depth 0.16` thin slabs like existing partitions.
4. Edges: the original `setBoundary` calls for the spanned cells must be REPLACED by
   boundaries matching the recessed shape, so collision/traversal agrees with visuals:
   the alcove interior cells remain open and reachable only from the recessed side.
   Implement by computing the alcove cell set first, then running the normal boundary
   loop with the alcove span treated like an opening, then setting boundaries for the
   back wall and the two returns explicitly with `setBoundary`.
5. Determinism: roll all alcove randomness immediately after the opening rolls for that
   partition, in a fixed order (chance, span position, width, depth, side).

## 5. Connector variation, doorway jogs, accidental connectors

In the BSP split loop:

1. **Variable width**: `connector = 1 + floor(random() * GAME_CONFIG.maze.connectorWidthCells)`
   (1..3) rolled per split, replacing the fixed constant. Keep the existing
   secondary-opening logic but it rolls its own width too.
2. **Bonus "wrong wall" connector**: with probability `bonusConnectorChance`, add a third
   opening of width 1, positioned within 2–3 cells of one end of the partition (near a
   corner), not overlapping other openings. Extend the partition helpers to accept a
   third opening pair (or generalize to an `openings: Array<[start, end]>` parameter —
   preferred refactor; update existing call sites).
3. **Doorway jog (baffle)**: after placing a split partition, for each opening with
   probability `doorJogChance`: emit a short baffle wall parallel to the partition,
   offset 1 cell into one side (side alternates by `(zone-ish index + opening index) % 2`
   plus a random flip), spanning `openingWidth + 1` cells, centered on the opening,
   kind `"wall"`. Skip if the baffle would land outside the parent rect interior or
   within 1 cell of another perpendicular wall line (check edge bits). This forces an
   S-curve through the doorway and kills straight sightlines between zones.

## 6. Connectivity repair (CRITICAL — do not skip)

After ALL features/edges/closed-cells are placed and BEFORE `chooseSpawns`:

1. Flood fill from the first open cell using `canTraverse` semantics (4-neighbor,
   respecting edge bits and closed cells).
2. If unreachable open cells exist, repair deterministically:
   - For each unreachable region (iterate cells in row-major order), find a boundary
     cell pair (reachable cell adjacent to unreachable cell) and open it:
     - If separated by a closed pillar cell: reopen the cell (`cells[idx] = 1`) and
       remove the corresponding pillar feature from `features`.
     - If separated by edge bits: clear the edge bit pair AND remove/shorten the wall
       feature covering that 1-cell span (split the feature slab into two shorter slabs
       around the new gap — reuse the flush/segment logic).
   - Re-run flood fill; loop until fully connected. Bound the loop (e.g. 50 iterations)
     and throw on failure so tests catch generator bugs.
3. This pass must be deterministic (no `random()` needed — row-major scan order).

## 7. Spatial hash for features (perf)

Feature count will roughly triple. `canOccupy` currently scans ALL features per corner
check per substep; fix this:

1. In `generateMaze.ts`, after generation, build and attach to `Maze`:
   `featureGrid: Map<number, OfficeFeature[]>` keyed by `cellZ * width + cellX`, where
   each feature is inserted into every cell its AABB (in grid units, expanded by 1 cell)
   overlaps. Exclude the 4 outer boundary wall slabs from the grid and instead always
   test them (they're huge; or simply include them in every border cell they touch —
   either is fine, but be consistent).
2. `collision.ts`: `canOccupy` queries only features in the 3x3 cell neighborhood of
   `worldToCell(position)` (dedupe via a `Set` if a feature spans multiple buckets).
   Behavior must be byte-identical to the brute-force version — add a test comparing
   both implementations on 500 seeded random positions.
3. `updateEnemy.ts` LOS: optional but preferred — walk the ray's cell line and test only
   bucketed features. If too risky, leave LOS as-is; it runs less often than collision.
4. `featureGrid` must NOT be part of `hashMap` input (derived data).

## 8. Ceiling grid + lights (`GameRenderer.ts`)

Keep the single large ceiling plane as the backdrop, then add:

1. **Per-zone T-bar lattice**: one `InstancedMesh` of thin boxes
   (`0.04 x 0.05 x length`) forming grid lines at 1-cell spacing across each zone's
   bounds, hung at `wallHeight - 0.04`. Each zone gets a deterministic offset
   `(ox, oz)` derived from `zone.id` (e.g. `ox = ((zone.id * 7919) % 100) / 100 * ceilingJitter`)
   — NOT from `random()`, since the renderer must not consume generator randomness.
   Lines from neighboring zones will visibly misalign at zone boundaries. Clip lines to
   zone bounds. Material: `MeshBasicMaterial`, color `0xb9b8ad`, no texture.
   Budget: this is on the order of ~10k thin instances across 50 zones on a 151x151 map;
   if instance count exceeds ~20k, fall back to 2-cell spacing.
2. **Light panels**: replace the global `+= 6` grid loop with per-zone placement snapped
   to that zone's lattice (every 3rd intersection), inheriting the zone offset so lights
   misalign zone-to-zone too. Per panel, deterministically from `zone.id` + index:
   ~12% rotated 90°, ~8% dimmed (`color 0x9a9a8e`), skip if the host cell is closed.
3. No changes to fog, tone mapping, or adaptive resolution logic.

## 9. Tests (`src/maze/generateMaze.test.ts`)

- Update count thresholds to match new density (run generator on a few seeds first,
  then set bounds with ~20% slack; do not hardcode exact counts).
- Keep/verify determinism test (two generations of same seed produce identical
  `cells`, `edges`, `zoneIds`, `features`, `hash`).
- NEW: full connectivity — every open cell reachable from `spawnCells[0]` via
  `canTraverse` (this validates §6).
- NEW: spatial-hash equivalence test (§7.2).
- NEW: sightline cap — from 200 seeded random open cells, cast rays along ±X and ±Z;
  assert the 95th percentile unobstructed straight run is <= 16 cells (tune the bound
  after first run; the point is to lock in "never see more than a few seconds ahead").
- Update `generatorVersion` expectations to `"office-v2"` anywhere asserted.
- Run `vitest` and the Playwright smoke suite; fix fallout.

## Acceptance criteria

1. Same seed => identical hash across runs (determinism preserved).
2. All open cells connected; spawns and enemy zone-search unaffected functionally.
3. Visual: standing in any mid-size zone, the player cannot see wall-to-wall across it;
   every zone has at least one full-height occluder (stub, pillar cluster, or alcove).
4. No straight corridor sightline beyond ~16 cells (95th percentile).
5. Ceiling grid visibly misaligns across at least some zone boundaries.
6. 60fps not regressed on the same hardware profile (adaptive resolution should not
   drop below current baseline; collision spatial hash in place).
7. Zones remain mundane: only walls/dividers/counters/pillars — no new feature kinds
   beyond what's listed here.
