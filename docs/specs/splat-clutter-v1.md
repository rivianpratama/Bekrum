# Spec: Splat Clutter v1 ("clutter-v1") — collision-enabled Backroom objects

## Goal
Place the 10 gaussian-splat furniture assets throughout the office/Backroom map as
PHYSICAL environmental objects: they block player and enemy movement, affect enemy
navigation, break sightlines, and create hiding spots, funnels, and near-barricades.
Composition must read as "the Backroom swallowed office objects and rearranged them
wrong": isolated chairs in open voids, leaning/stacked/intersecting piles, awkward
door-adjacent pinches — never normal interior design, never clean prop placement.

## Non-goals
- No physics engine. Collision stays 2D AABB vs features (existing system).
- No changes to enemy AI decision logic, networking protocol, or player movement values.
- No per-splat-point collision. Colliders are simplified bounding proxies only.
- Do not break determinism: identical seed => identical clutter + identical map hash
  on all clients. Never use `Math.random()` anywhere in generation.

## Assets
The 10 splat files currently in `src/assets/`:
`bed.splat, cabinet.splat, christmas.splat, cuck.splat, desk.splat, king.splat,
lamp.splat, office.splat, sofa.splat, splat.splat`

1. MOVE them to `public/assets/clutter/` so they are fetchable at runtime
   (pattern: `enemy.splat` already lives in `public/assets/`). Optionally rename
   `cuck.splat` to `chair-odd.splat` and `splat.splat` to `mass.splat` for sanity;
   if renamed, update the manifest only — nothing else references them.
2. Extend `scripts/convert-ply-to-splat.mjs` (or add `scripts/downsample-splat.mjs`)
   with a `--max-splats N` option that truncates the importance-sorted rows. Add an
   npm script `prep:clutter` that caps every clutter asset at
   `GAME_CONFIG.clutter.maxSplatsPerAsset` (default 40_000) writing into
   `public/assets/clutter/`. Rendering 10 assets x ~15 instances each must stay
   within sort budget (see §7).

## Files
- `src/shared/config.ts` — new `clutter` config block (§1).
- `src/assets/clutterManifest.ts` — NEW: static metadata for the 10 assets (§2).
- `src/maze/placeClutter.ts` — NEW: deterministic placement + validation (§3–§5).
- `src/maze/generateMaze.ts` — integrate placement, doorway extraction, hashing (§6).
- `src/shared/types.ts` — extend `MazeDescriptor.generatorVersion` to `"office-v3"`.
- `src/rendering/ClutterVisuals.ts` — NEW: splat loading + fallback (§7).
- `src/rendering/GameRenderer.ts` — integrate visuals; skip box-rendering for clutter.
- `src/maze/placeClutter.test.ts` — NEW tests (§8); update existing tests for v3.

---

## 1. Config (`src/shared/config.ts`)

```ts
clutter: {
  enabled: true,
  maxInstances: 160,            // hard cap across whole map
  navClearanceMeters: 0.95,     // min free passage: > 2*max(player .38, enemy .42) radius
  doorClearanceMeters: 0.95,    // min remaining width through any doorway
  colliderShrink: 0.85,         // collider AABB = rotated-footprint AABB * this
  sealedPocketChance: 0.04,     // per eligible small zone
  maxSealedPockets: 2,
  maxSplatsPerAsset: 40_000,
  archetypeWeights: {           // per-zone composition rolls (§4)
    empty: 0.18,
    sparse: 0.34,
    cluster: 0.22,
    barricade: 0.14,
    swallowed: 0.12,
  },
},
```

## 2. Asset manifest (`src/assets/clutterManifest.ts`)

Hand-authored, tuned in-game later. Per asset:

```ts
export interface ClutterAsset {
  id: string;                    // "desk", "cabinet", ...
  url: string;                   // "/assets/clutter/desk.splat"
  footprint: { width: number; depth: number; height: number }; // METERS, upright
  blocksSight: boolean;          // true if height >= 1.35 (cabinet, mass, christmas...)
  stackable: boolean;            // can sit on top of another (lamp, chair, ...)
  base: boolean;                 // can carry a stacked item (desk, cabinet, bed, sofa)
  yOffset: number;               // splat origin correction so it sits on the floor
  splatScale: number;            // uniform render scale matching footprint
  rotationFix: [number, number, number, number]; // quaternion, like enemy splat uses
}
```

Author rough footprints by eyeballing each asset once (e.g. desk 1.4x0.7x0.75,
cabinet 0.9x0.45x1.8, lamp 0.4x0.4x1.5, bed 2.0x1.0x0.6, sofa 1.9x0.9x0.8, ...).
Exact values are tuning, not correctness — colliders derive from these.

## 3. Data model

```ts
export interface ClutterInstance {
  assetId: string;
  // grid-space center (same float coordinate system as OfficeFeature.x/z)
  x: number; z: number;
  y: number;          // METERS above floor (0 for grounded, >0 for stacked items)
  yaw: number;        // radians, free
  tiltAxis: 0 | 1;    // visual-only lean axis (x or z)
  tiltAngle: number;  // radians, visual-only; 0 for most, up to ~0.22, rarely ~PI/2 (toppled)
  scale: number;      // 0.85..1.15 uniform jitter
  featureIndex: number; // index into maze.features of its collider, or -1 (stacked items share base collider)
}
```

`Maze` gains `clutter: ClutterInstance[]` and `doorCells: Vec2[]`.
`OfficeFeatureKind` gains `"clutter"`.

### Collider construction (CRITICAL unit rules)
- Collision/LOS read `feature.width/depth` in **CELL units** (multiplied by
  `cellSize` in `featureBounds`) and `feature.height` in **METERS**. Convert:
  `feature.width = footprintAabbWidthMeters / cellSize`.
- Rotated footprint AABB: for yaw `r`, upright size `w x d`:
  `aabbW = |w·cos r| + |d·sin r|`, `aabbD = |w·sin r| + |d·cos r|`, then multiply
  both by `colliderShrink` and by instance `scale`.
- One collider per grounded instance. A stack contributes ONE collider sized for the
  base item, `height = base.height + 0.6 * top.height` (meters), `blocksSight` true
  if that total >= 1.35. Toppled instances (tilt ~PI/2) swap height with the lean-axis
  footprint dimension for the collider (a fallen cabinet is long and low).
- Clutter colliders are pushed into `maze.features` so `canOccupy`, `featureGrid`,
  and `hasLineOfSight` work unchanged. The renderer must SKIP `kind === "clutter"`
  in the instanced-box pass (visuals come from splats, §7).

## 4. Placement algorithm (`placeClutter(maze, random)`)

Runs inside `generateMaze` AFTER `repairConnectivity` and BEFORE `buildFeatureGrid`
and `chooseSpawns`, consuming the SAME seeded `random()` stream in fixed order:
iterate zones in `zone.id` order; within a zone, roll archetype first, then each
placement's rolls in a fixed sequence (anchor, asset, offset, yaw, tilt, scale,
stack). Never reorder rolls conditionally on non-deterministic data.

### 4.0 Doorway extraction
Before placing: scan all open cells; a cell is a **door cell** if it has a
traversable edge (via `canTraverse`) to a neighbor with a different `zoneIds`
value. Store unique door cells in `maze.doorCells`. Build a `doorMask`
(Uint8Array): door cells + their 4-neighbors = protected apron.

### 4.1 Zone archetypes
Per zone, weighted roll from `archetypeWeights`:

- **empty** — zero clutter. Silence as contrast; do not skip this case.
- **sparse** — 1–3 isolated objects placed WRONG: a single chair facing a blank
  wall, a lamp dead-center in the largest open area of the zone, a desk 0.3 cells
  from a corner but rotated 30–60° off the wall. Anchors: 40% exposed center
  (farthest-from-feature cell in zone), 35% near wall/partition (offset 0.4–1.0
  cells, never flush), 25% adjacent to a pillar or alcove mouth.
- **cluster** — one loose group of 3–5 objects within a 2–3 cell radius blob, with
  off-angle yaws (roll yaw as `basis + (random()-0.5)*1.2` so they almost-relate),
  plus 30% chance of one stack and 40% chance of one pair of visually intersecting
  objects (place second object so visual footprints overlap 15–30% — colliders
  may overlap freely, that is fine and desired).
- **barricade** — 2–4 objects forming an accidental line near a partition opening
  or stub wall inside the zone (NOT on `doorMask` apron cells): aligned within
  ±15° of the wall axis, gaps of 0.5–1.1 cells between them so the line reads as
  a broken barricade you slip through. One element 60% likely toppled or leaning
  (tilt 0.12–0.22, or PI/2 toppled).
- **swallowed** — dense awkward mass: 5–8 objects in a 3x3..4x4 cell patch, with
  1–2 stacks, 2+ intersections, mixed tilts, at least one object rotated to a
  "useless" orientation (bed on its side against nothing). Keep a guaranteed free
  channel >= navClearance through or around the patch (verify with §5 local check
  before committing).

Zone eligibility: skip zones whose area < 24 cells for cluster/swallowed; demote
to sparse. Respect the global `maxInstances` cap — stop placing when reached
(iterate zones in id order so the cap is deterministic).

### 4.2 Door-adjacent tension (applies across archetypes)
With 35% probability per zone that has door cells, place ONE extra object 1–2
cells from a door cell, offset to one side so the passage narrows but the
remaining clear width through the door apron stays >= `doorClearanceMeters`
(compute against the door's free span minus the collider intrusion; if violated,
slide the object away from the apron along its offset axis until satisfied, or
drop it). Doors should often FEEL pinched, never be sealed.

### 4.3 Candidate acceptance (per placement, before commit)
Reject and reroll (max 6 attempts, then skip) if the collider:
- intersects any existing feature AABB by more than 25% of its own area
  (small overlaps with walls/clutter are allowed and wanted),
- covers a spawn-candidate zone center cell or the enemy spawn cell,
- overlaps a `doorMask` cell beyond the §4.2 clearance rule,
- would leave less than `navClearanceMeters` of free passage in its host cell row
  AND column (local check: cell span 3 cells each direction, subtract all
  collider+wall intervals, require one contiguous free interval >= clearance in at
  least one axis).

### 4.4 Sealed pockets (intentional, rare)
Before normal placement: collect zones with area <= 40 and exactly ONE door cell.
For each, roll `sealedPocketChance` (stop after `maxSealedPockets`). If selected
and the zone contains no player-spawn candidate and not the enemy spawn cell:
fill the door cell + apron with a deliberate dense barricade (2–3 large assets,
stacked/toppled, colliders allowed to fully block), then set the pocket's
interior cells to `cells=0`-equivalent reachability by ALSO setting the door
edge bits closed via `setBoundary` so grid pathing agrees. Optionally drop one
lamp inside the pocket, visible through nothing — an unreachable Backroom pocket
that looks placed, not broken. Record pocket zone ids on the maze (non-hashed
debug field is fine) so tests can whitelist them.

## 5. Post-placement validation (CRITICAL — do not skip)

Order matters; all deterministic (row-major scans, no random()):

1. **Cell closure pass**: for every cell whose total clutter-collider coverage
   leaves < navClearance free in BOTH axes (same interval math as §4.3): try
   closing the cell (`cells=0`). Flood-fill (reachableMask semantics with the
   closure applied); if any open cell outside sealed pockets becomes unreachable,
   revert and instead shrink that cell's largest clutter collider by 15% steps
   (up to 3 times), then delete it if still violating.
2. **Door fat-path check**: for every door cell, sample a crossing path (door
   cell center to each adjacent-zone neighbor center, 8 interpolated points) and
   require `canOccupy(maze, point, max(playerRadius, enemyRadius) + 0.05)` for a
   contiguous corridor — allow lateral slide of sample points up to ±0.6m to find
   the corridor (doors may be pinched off-center). On failure: shrink/delete the
   nearest clutter collider as in step 1. Sealed-pocket doors are exempt.
3. **Global connectivity**: flood fill from first open cell; all open cells
   reachable except sealed-pocket interiors. Loop steps 1–3 max 20 iterations;
   throw on failure so tests catch generator bugs.
4. Then `buildFeatureGrid` (clutter included), then `chooseSpawns` (unchanged —
   it operates on the final cells/edges, so spawns avoid pockets automatically).

## 6. Determinism + hashing (`generateMaze.ts`)

- Bump `generatorVersion` to `"office-v3"` (descriptor type + everywhere asserted).
- Clutter colliders ride through the existing `hashMap` features loop.
- ALSO hash visual params: extend `hashMap` with each `ClutterInstance`'s
  quantized `x, z, y, yaw, tiltAxis, tiltAngle, scale` and `assetId.length` +
  char codes, same x100-quantize pattern as features. Visual desync = real desync.
- `doorCells` and any debug fields stay OUT of the hash (derived data).
- `featureGrid` already excluded — keep it that way.

## 7. Rendering (`src/rendering/ClutterVisuals.ts` + `GameRenderer.ts`)

1. ONE shared `DropInViewer` (`gpuAcceleratedSort: false`,
   `sharedMemoryForWorkers: false`, `dynamicScene: false`) hosting every instance
   as a splat scene via `addSplatScenes` (batch call) with per-scene
   `position/rotation/scale`: position from `gridToWorld(instance) + y`,
   rotation = `rotationFix` quaternion composed with yaw and tilt, scale =
   `splatScale * instance.scale`. Mirror `loadEnemyVisual`'s HEAD-check +
   try/catch pattern per asset URL.
2. Each asset file is fetched/parsed ONCE if the library version supports scene
   reuse; if 0.4.7 forces per-scene parsing, parse per instance but enforce the
   `maxInstances` budget and the `maxSplatsPerAsset` cap so total splat count
   stays <= ~3–4M points worst case; if the first-load total exceeds budget,
   log a warning and drop lowest-priority instances (sparse-archetype singles
   last — keep them; drop from swallowed patches first, deterministically by
   instance index). Measure: initial sort must not freeze the main thread > 2s;
   if it does, halve `maxSplatsPerAsset` and re-run `prep:clutter`.
3. **Fallback**: per failed asset, render its instances as `MeshBasicMaterial`
   boxes (color 0x8a8473) matching the manifest footprint with yaw/tilt applied,
   so gameplay never depends on splat loading. Set
   `canvas.dataset.clutterVisual = "splat" | "partial" | "fallback"`.
4. `GameRenderer.buildMaze`: skip `kind === "clutter"` when building the
   instanced feature boxes. Everything else (lattice, lights, fog) untouched.
5. Dispose: viewer + fallback geometry/materials in `dispose()`.

## 8. Tests

- **Determinism**: same seed twice => identical `clutter` array, identical hash;
  different seeds => different clutter (sanity).
- **Connectivity**: all open cells reachable from `spawnCells[0]` except cells
  inside recorded sealed pockets; sealed pockets count <= maxSealedPockets.
- **Door clearance**: for 10 seeds, every non-pocket door cell passes the §5.2
  fat-path check at enemy radius.
- **Budget**: instance count <= maxInstances; per-zone collider area <= 35% of
  zone open area.
- **Unit rule**: regression test that a clutter feature's world AABB
  (via `featureBounds`) matches manifest meters within shrink tolerance —
  catches the cell-unit/meter conversion bug.
- **Renderer-free**: placement module must not import three.js (keeps simulation
  worker/server-safe). Lint or test for it.
- Update existing maze tests for `"office-v3"`; run vitest + Playwright smoke.

## Acceptance criteria
1. Same seed => identical hash across clients; clutter affects collision, enemy
   movement, and LOS identically everywhere.
2. Player and enemy can traverse every non-pocket door; many doors feel pinched.
3. Zones visibly vary: some empty, some single wrong objects, some dense
   swallowed masses; no zone reads as furnished-on-purpose.
4. At most 2 sealed pockets per map, and they read as intentional.
5. No 60fps regression beyond adaptive-resolution baseline; splat load failure
   degrades to boxes, never to missing collision (colliders exist regardless).
