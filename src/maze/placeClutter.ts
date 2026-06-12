import {
  CLUTTER_ASSET_BY_ID,
  CLUTTER_ASSETS,
  type ClutterAsset,
} from "../assets/clutterManifest";
import { GAME_CONFIG } from "../shared/config";
import type { Vec2 } from "../shared/types";
import type {
  ClutterInstance,
  Maze,
  OfficeFeature,
  OfficeZone,
} from "./generateMaze";

const EDGE_NORTH = 1;
const EDGE_EAST = 2;
const EDGE_SOUTH = 4;
const EDGE_WEST = 8;
const DIRECTIONS = [
  { x: 0, z: -1, edge: EDGE_NORTH, opposite: EDGE_SOUTH },
  { x: 1, z: 0, edge: EDGE_EAST, opposite: EDGE_WEST },
  { x: 0, z: 1, edge: EDGE_SOUTH, opposite: EDGE_NORTH },
  { x: -1, z: 0, edge: EDGE_WEST, opposite: EDGE_EAST },
] as const;
const LARGE_ASSETS = CLUTTER_ASSETS.filter(
  (asset) => asset.footprint.width >= 0.9 || asset.footprint.depth >= 0.9,
);
const BASE_ASSETS = CLUTTER_ASSETS.filter((asset) => asset.base);
const STACKABLE_ASSETS = CLUTTER_ASSETS.filter((asset) => asset.stackable);
const ZONE_CELLS_CACHE = new WeakMap<Maze, Map<number, Vec2[]>>();
const FARTHEST_CELL_CACHE = new WeakMap<Vec2[], Vec2>();
const NEAR_STRUCTURE_CACHE = new WeakMap<Vec2[], Vec2[]>();

type Archetype = keyof typeof GAME_CONFIG.clutter.archetypeWeights;

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface PlacementRolls {
  anchor: number;
  asset: number;
  offset: number;
  yaw: number;
  tilt: number;
  scale: number;
  stack: number;
}

interface PlacementContext {
  archetype: Archetype;
  index: number;
  count: number;
  basis: number;
  clusterCenter: Vec2;
  intersectionTarget?: ClutterInstance;
  forceStack: boolean;
  forceTopple: boolean;
}

function cellIndex(maze: Maze, x: number, z: number): number {
  return z * maze.descriptor.width + x;
}

function isOpen(maze: Maze, x: number, z: number): boolean {
  return (
    x >= 0 &&
    z >= 0 &&
    x < maze.descriptor.width &&
    z < maze.descriptor.height &&
    maze.cells[cellIndex(maze, x, z)] === 1
  );
}

function canTraverseGrid(
  maze: Maze,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  if (!isOpen(maze, fromX, fromZ) || !isOpen(maze, toX, toZ)) return false;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const edge =
    dx === 1 && dz === 0
      ? EDGE_EAST
      : dx === -1 && dz === 0
        ? EDGE_WEST
        : dx === 0 && dz === 1
          ? EDGE_SOUTH
          : dx === 0 && dz === -1
            ? EDGE_NORTH
            : 0;
  return edge !== 0 && (maze.edges[cellIndex(maze, fromX, fromZ)] & edge) === 0;
}

function featureBounds(feature: OfficeFeature): Bounds {
  return {
    minX: feature.x - feature.width / 2,
    maxX: feature.x + feature.width / 2,
    minZ: feature.z - feature.depth / 2,
    maxZ: feature.z + feature.depth / 2,
  };
}

function overlapArea(left: Bounds, right: Bounds): number {
  const width = Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX));
  const depth = Math.max(0, Math.min(left.maxZ, right.maxZ) - Math.max(left.minZ, right.minZ));
  return width * depth;
}

function containsPoint(bounds: Bounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

function pickFrom<T>(values: readonly T[], roll: number): T {
  return values[Math.min(values.length - 1, Math.floor(roll * values.length))];
}

function rollPlacement(random: () => number): PlacementRolls {
  return {
    anchor: random(),
    asset: random(),
    offset: random(),
    yaw: random(),
    tilt: random(),
    scale: random(),
    stack: random(),
  };
}

function rollArchetype(random: () => number): Archetype {
  const roll = random();
  let total = 0;
  for (const archetype of [
    "empty",
    "sparse",
    "cluster",
    "barricade",
    "swallowed",
  ] as const) {
    total += GAME_CONFIG.clutter.archetypeWeights[archetype];
    if (roll < total) return archetype;
  }
  return "swallowed";
}

function zoneCells(maze: Maze, zone: OfficeZone): Vec2[] {
  let mazeCache = ZONE_CELLS_CACHE.get(maze);
  if (!mazeCache) {
    mazeCache = new Map();
    ZONE_CELLS_CACHE.set(maze, mazeCache);
  }
  const cached = mazeCache.get(zone.id);
  if (cached) return cached;
  const cells: Vec2[] = [];
  const zoneId = zone.id + 1;
  for (let z = zone.z; z < zone.z + zone.height; z += 1) {
    for (let x = zone.x; x < zone.x + zone.width; x += 1) {
      if (isOpen(maze, x, z) && maze.zoneIds[cellIndex(maze, x, z)] === zoneId) {
        cells.push({ x, z });
      }
    }
  }
  mazeCache.set(zone.id, cells);
  return cells;
}

function nearestOpenToCenter(cells: Vec2[], zone: OfficeZone): Vec2 {
  const targetX = zone.x + zone.width / 2;
  const targetZ = zone.z + zone.height / 2;
  let best = cells[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const distance = Math.abs(cell.x + 0.5 - targetX) + Math.abs(cell.z + 0.5 - targetZ);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best;
}

function farthestFromFeatures(maze: Maze, cells: Vec2[]): Vec2 {
  const cached = FARTHEST_CELL_CACHE.get(cells);
  if (cached) return cached;
  let best = cells[0];
  let bestDistance = -1;
  for (const cell of cells) {
    let nearest = Number.POSITIVE_INFINITY;
    const center = { x: cell.x + 0.5, z: cell.z + 0.5 };
    for (const feature of maze.features) {
      const bounds = featureBounds(feature);
      const dx = Math.max(bounds.minX - center.x, 0, center.x - bounds.maxX);
      const dz = Math.max(bounds.minZ - center.z, 0, center.z - bounds.maxZ);
      nearest = Math.min(nearest, Math.hypot(dx, dz));
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = cell;
    }
  }
  FARTHEST_CELL_CACHE.set(cells, best);
  return best;
}

function cellsNearStructure(maze: Maze, cells: Vec2[]): Vec2[] {
  const cached = NEAR_STRUCTURE_CACHE.get(cells);
  if (cached) return cached;
  const near = cells.filter((cell) => {
    const current = cellIndex(maze, cell.x, cell.z);
    if ((maze.edges[current] & (EDGE_NORTH | EDGE_EAST | EDGE_SOUTH | EDGE_WEST)) !== 0) {
      return true;
    }
    return maze.features.some((feature) => {
      const bounds = featureBounds(feature);
      return (
        bounds.maxX >= cell.x - 0.5 &&
        bounds.minX <= cell.x + 1.5 &&
        bounds.maxZ >= cell.z - 0.5 &&
        bounds.minZ <= cell.z + 1.5
      );
    });
  });
  NEAR_STRUCTURE_CACHE.set(cells, near);
  return near;
}

function selectAnchor(
  maze: Maze,
  zone: OfficeZone,
  cells: Vec2[],
  rolls: PlacementRolls,
): Vec2 {
  if (rolls.anchor < 0.4) return farthestFromFeatures(maze, cells);
  const near = cellsNearStructure(maze, cells);
  if (rolls.anchor < 0.75 && near.length > 0) return pickFrom(near, rolls.offset);
  const pillars = maze.features.filter(
    (feature) =>
      feature.kind === "pillar" &&
      feature.x >= zone.x - 1 &&
      feature.x <= zone.x + zone.width + 1 &&
      feature.z >= zone.z - 1 &&
      feature.z <= zone.z + zone.height + 1,
  );
  if (pillars.length > 0) {
    const pillar = pickFrom(pillars, rolls.offset);
    let closest = cells[0];
    let distance = Number.POSITIVE_INFINITY;
    for (const cell of cells) {
      const next = Math.hypot(cell.x + 0.5 - pillar.x, cell.z + 0.5 - pillar.z);
      if (next < distance) {
        distance = next;
        closest = cell;
      }
    }
    return closest;
  }
  return pickFrom(cells, rolls.offset);
}

function colliderDimensions(
  asset: ClutterAsset,
  instance: Pick<ClutterInstance, "yaw" | "tiltAxis" | "tiltAngle" | "scale">,
): { widthMeters: number; depthMeters: number; heightMeters: number } {
  let width = asset.footprint.width * instance.scale;
  let depth = asset.footprint.depth * instance.scale;
  let height = asset.footprint.height * instance.scale;
  if (instance.tiltAngle > Math.PI / 3) {
    if (instance.tiltAxis === 0) {
      [depth, height] = [height, depth];
    } else {
      [width, height] = [height, width];
    }
  }
  const cosine = Math.abs(Math.cos(instance.yaw));
  const sine = Math.abs(Math.sin(instance.yaw));
  return {
    widthMeters: (width * cosine + depth * sine) * GAME_CONFIG.clutter.colliderShrink,
    depthMeters: (width * sine + depth * cosine) * GAME_CONFIG.clutter.colliderShrink,
    heightMeters: height,
  };
}

function createCollider(
  maze: Maze,
  asset: ClutterAsset,
  instance: ClutterInstance,
): OfficeFeature {
  const dimensions = colliderDimensions(asset, instance);
  return {
    kind: "clutter",
    x: instance.x,
    z: instance.z,
    width: dimensions.widthMeters / maze.descriptor.cellSize,
    depth: dimensions.depthMeters / maze.descriptor.cellSize,
    height: dimensions.heightMeters,
    blocksSight: asset.blocksSight || dimensions.heightMeters >= 1.35,
  };
}

function maximumFreeInterval(
  minimum: number,
  maximum: number,
  intervals: Array<readonly [number, number]>,
): number {
  const clipped = intervals
    .map(([start, end]) => [Math.max(minimum, start), Math.min(maximum, end)] as const)
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let cursor = minimum;
  let largest = 0;
  for (const [start, end] of clipped) {
    largest = Math.max(largest, start - cursor);
    cursor = Math.max(cursor, end);
  }
  return Math.max(largest, maximum - cursor);
}

function cellFreeAxes(
  maze: Maze,
  x: number,
  z: number,
  features: readonly OfficeFeature[] = maze.features,
): { horizontal: number; vertical: number } {
  const horizontalIntervals: Array<readonly [number, number]> = [];
  const verticalIntervals: Array<readonly [number, number]> = [];
  const centerX = x + 0.5;
  const centerZ = z + 0.5;
  for (const feature of features) {
    const bounds = featureBounds(feature);
    if (bounds.minZ <= centerZ && bounds.maxZ >= centerZ) {
      horizontalIntervals.push([bounds.minX, bounds.maxX]);
    }
    if (bounds.minX <= centerX && bounds.maxX >= centerX) {
      verticalIntervals.push([bounds.minZ, bounds.maxZ]);
    }
  }
  const cellSize = maze.descriptor.cellSize;
  return {
    horizontal: maximumFreeInterval(x - 1, x + 2, horizontalIntervals) * cellSize,
    vertical: maximumFreeInterval(z - 1, z + 2, verticalIntervals) * cellSize,
  };
}

function hasLocalPassage(
  maze: Maze,
  feature: OfficeFeature,
): boolean {
  const x = Math.floor(feature.x);
  const z = Math.floor(feature.z);
  const free = cellFreeAxes(maze, x, z, [...maze.features, feature]);
  return (
    free.horizontal >= GAME_CONFIG.clutter.navClearanceMeters ||
    free.vertical >= GAME_CONFIG.clutter.navClearanceMeters
  );
}

function overlapsDoorMask(maze: Maze, bounds: Bounds, doorMask: Uint8Array): boolean {
  const minimumX = Math.max(0, Math.floor(bounds.minX));
  const maximumX = Math.min(maze.descriptor.width - 1, Math.floor(bounds.maxX));
  const minimumZ = Math.max(0, Math.floor(bounds.minZ));
  const maximumZ = Math.min(maze.descriptor.height - 1, Math.floor(bounds.maxZ));
  for (let z = minimumZ; z <= maximumZ; z += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      if (
        doorMask[cellIndex(maze, x, z)] &&
        overlapArea(bounds, { minX: x, maxX: x + 1, minZ: z, maxZ: z + 1 }) > 0.001
      ) {
        return true;
      }
    }
  }
  return false;
}

function zoneColliderArea(maze: Maze, zone: OfficeZone): number {
  const zoneBounds = {
    minX: zone.x,
    maxX: zone.x + zone.width,
    minZ: zone.z,
    maxZ: zone.z + zone.height,
  };
  return maze.features
    .filter((feature) => feature.kind === "clutter")
    .reduce((area, feature) => area + overlapArea(zoneBounds, featureBounds(feature)), 0);
}

function candidateAccepted(
  maze: Maze,
  zone: OfficeZone,
  feature: OfficeFeature,
  doorMask: Uint8Array,
  protectedCenters: Vec2[],
  allowDoorMask: boolean,
): boolean {
  const hostX = Math.floor(feature.x);
  const hostZ = Math.floor(feature.z);
  if (
    !isOpen(maze, hostX, hostZ) ||
    maze.zoneIds[cellIndex(maze, hostX, hostZ)] !== zone.id + 1
  ) {
    return false;
  }
  const bounds = featureBounds(feature);
  if (
    bounds.minX < 1 ||
    bounds.minZ < 1 ||
    bounds.maxX > maze.descriptor.width - 1 ||
    bounds.maxZ > maze.descriptor.height - 1
  ) {
    return false;
  }
  const candidateArea = feature.width * feature.depth;
  if (
    maze.features.some(
      (existing) => overlapArea(bounds, featureBounds(existing)) > candidateArea * 0.25,
    )
  ) {
    return false;
  }
  if (protectedCenters.some((center) => containsPoint(bounds, center))) return false;
  if (!allowDoorMask && overlapsDoorMask(maze, bounds, doorMask)) return false;
  const zoneArea = zoneCells(maze, zone).length;
  if (zoneColliderArea(maze, zone) + candidateArea > zoneArea * 0.35) return false;
  return hasLocalPassage(maze, feature);
}

function addGroundedInstance(
  maze: Maze,
  instance: ClutterInstance,
  feature: OfficeFeature,
): ClutterInstance {
  instance.featureIndex = maze.features.length;
  maze.features.push(feature);
  maze.clutter.push(instance);
  return instance;
}

function addStackedInstance(
  maze: Maze,
  base: ClutterInstance,
  baseAsset: ClutterAsset,
  rolls: PlacementRolls,
): void {
  if (
    maze.clutter.length >= GAME_CONFIG.clutter.maxInstances ||
    !baseAsset.base ||
    STACKABLE_ASSETS.length === 0
  ) {
    return;
  }
  const topAsset = pickFrom(STACKABLE_ASSETS, (rolls.asset + rolls.stack) % 1);
  const top: ClutterInstance = {
    assetId: topAsset.id,
    x: base.x + Math.cos(rolls.offset * Math.PI * 2) * 0.08,
    z: base.z + Math.sin(rolls.offset * Math.PI * 2) * 0.08,
    y: baseAsset.footprint.height * base.scale,
    yaw: base.yaw + (rolls.yaw - 0.5) * 1.2,
    tiltAxis: rolls.tilt < 0.5 ? 0 : 1,
    tiltAngle: (rolls.tilt - 0.5) * 0.18,
    scale: 0.85 + rolls.scale * 0.3,
    featureIndex: -1,
  };
  maze.clutter.push(top);
  const feature = maze.features[base.featureIndex];
  feature.height =
    baseAsset.footprint.height * base.scale +
    topAsset.footprint.height * top.scale * 0.6;
  feature.blocksSight = feature.height >= 1.35;
}

function placementAsset(context: PlacementContext, rolls: PlacementRolls): ClutterAsset {
  if (context.forceStack) return pickFrom(BASE_ASSETS, rolls.asset);
  if (context.archetype === "barricade" || context.archetype === "swallowed") {
    return pickFrom(LARGE_ASSETS, rolls.asset);
  }
  return pickFrom(CLUTTER_ASSETS, rolls.asset);
}

function placementPosition(
  maze: Maze,
  zone: OfficeZone,
  cells: Vec2[],
  context: PlacementContext,
  rolls: PlacementRolls,
): Vec2 {
  if (context.intersectionTarget) {
    const asset = CLUTTER_ASSET_BY_ID.get(context.intersectionTarget.assetId);
    const overlapDistance = asset
      ? Math.max(asset.footprint.width, asset.footprint.depth) /
        maze.descriptor.cellSize *
        (0.7 + rolls.offset * 0.15)
      : 0.35;
    const angle = rolls.anchor * Math.PI * 2;
    return {
      x: context.intersectionTarget.x + Math.cos(angle) * overlapDistance,
      z: context.intersectionTarget.z + Math.sin(angle) * overlapDistance,
    };
  }
  if (context.archetype === "cluster" || context.archetype === "swallowed") {
    const maximumRadius = context.archetype === "cluster" ? 2.5 : 1.8;
    const radius = Math.sqrt(rolls.offset) * maximumRadius;
    const angle = rolls.anchor * Math.PI * 2;
    return {
      x: context.clusterCenter.x + Math.cos(angle) * radius,
      z: context.clusterCenter.z + Math.sin(angle) * radius,
    };
  }
  if (context.archetype === "barricade") {
    const spacing = 0.5 + rolls.offset * 0.6;
    const offset = (context.index - (context.count - 1) / 2) * spacing;
    return {
      x: context.clusterCenter.x + Math.sin(context.basis) * offset,
      z: context.clusterCenter.z + Math.cos(context.basis) * offset,
    };
  }
  const anchor = selectAnchor(maze, zone, cells, rolls);
  const angle = rolls.offset * Math.PI * 2;
  const distance = rolls.anchor < 0.4 ? 0.15 : 0.2 + rolls.anchor * 0.3;
  return {
    x: anchor.x + 0.5 + Math.cos(angle) * distance,
    z: anchor.z + 0.5 + Math.sin(angle) * distance,
  };
}

function placementTilt(
  context: PlacementContext,
  rolls: PlacementRolls,
): Pick<ClutterInstance, "tiltAxis" | "tiltAngle"> {
  const tiltAxis: 0 | 1 = rolls.tilt < 0.5 ? 0 : 1;
  if (context.forceTopple) return { tiltAxis, tiltAngle: Math.PI / 2 };
  if (context.archetype === "swallowed" && context.index % 3 === 1) {
    return { tiltAxis, tiltAngle: 0.12 + rolls.tilt * 0.1 };
  }
  if (rolls.tilt < 0.04) return { tiltAxis, tiltAngle: Math.PI / 2 };
  if (rolls.tilt < 0.2) return { tiltAxis, tiltAngle: 0.12 + rolls.tilt * 0.5 };
  return { tiltAxis, tiltAngle: 0 };
}

function placementYaw(context: PlacementContext, rolls: PlacementRolls): number {
  if (context.archetype === "cluster") return context.basis + (rolls.yaw - 0.5) * 1.2;
  if (context.archetype === "barricade") {
    return context.basis + (rolls.yaw - 0.5) * (Math.PI / 6);
  }
  if (context.archetype === "swallowed" && context.index === 0) {
    return context.basis + Math.PI / 2;
  }
  return rolls.yaw * Math.PI * 2;
}

function tryPlacement(
  maze: Maze,
  zone: OfficeZone,
  cells: Vec2[],
  context: PlacementContext,
  random: () => number,
  doorMask: Uint8Array,
  protectedCenters: Vec2[],
): ClutterInstance | null {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rolls = rollPlacement(random);
    const asset = placementAsset(context, rolls);
    const position = placementPosition(maze, zone, cells, context, rolls);
    const tilt = placementTilt(context, rolls);
    const instance: ClutterInstance = {
      assetId: asset.id,
      x: position.x,
      z: position.z,
      y: 0,
      yaw: placementYaw(context, rolls),
      ...tilt,
      scale: 0.85 + rolls.scale * 0.3,
      featureIndex: -1,
    };
    const collider = createCollider(maze, asset, instance);
    if (!candidateAccepted(maze, zone, collider, doorMask, protectedCenters, false)) continue;
    addGroundedInstance(maze, instance, collider);
    if (context.forceStack || (rolls.stack < 0.3 && context.archetype !== "sparse")) {
      addStackedInstance(maze, instance, asset, rolls);
    }
    return instance;
  }
  return null;
}

function extractDoorCells(maze: Maze): {
  doorMask: Uint8Array;
  byZone: Map<number, Vec2[]>;
} {
  const doorMask = new Uint8Array(maze.cells.length);
  const byZone = new Map<number, Vec2[]>();
  const doors: Vec2[] = [];
  for (let z = 0; z < maze.descriptor.height; z += 1) {
    for (let x = 0; x < maze.descriptor.width; x += 1) {
      if (!isOpen(maze, x, z)) continue;
      const zoneId = maze.zoneIds[cellIndex(maze, x, z)];
      if (zoneId === 0) continue;
      const isDoor = DIRECTIONS.some((direction) => {
        const nextX = x + direction.x;
        const nextZ = z + direction.z;
        return (
          canTraverseGrid(maze, x, z, nextX, nextZ) &&
          maze.zoneIds[cellIndex(maze, nextX, nextZ)] !== zoneId
        );
      });
      if (!isDoor) continue;
      const door = { x, z };
      doors.push(door);
      const list = byZone.get(zoneId - 1) ?? [];
      list.push(door);
      byZone.set(zoneId - 1, list);
    }
  }
  maze.doorCells = doors;
  for (const door of doors) {
    doorMask[cellIndex(maze, door.x, door.z)] = 1;
    for (const direction of DIRECTIONS) {
      const x = door.x + direction.x;
      const z = door.z + direction.z;
      if (x >= 0 && z >= 0 && x < maze.descriptor.width && z < maze.descriptor.height) {
        doorMask[cellIndex(maze, x, z)] = 1;
      }
    }
  }
  return { doorMask, byZone };
}

function closePocketBoundaries(maze: Maze, zone: OfficeZone): void {
  const zoneId = zone.id + 1;
  for (let z = zone.z; z < zone.z + zone.height; z += 1) {
    for (let x = zone.x; x < zone.x + zone.width; x += 1) {
      if (!isOpen(maze, x, z) || maze.zoneIds[cellIndex(maze, x, z)] !== zoneId) continue;
      for (const direction of DIRECTIONS) {
        const nextX = x + direction.x;
        const nextZ = z + direction.z;
        if (
          !isOpen(maze, nextX, nextZ) ||
          maze.zoneIds[cellIndex(maze, nextX, nextZ)] === zoneId
        ) {
          continue;
        }
        maze.edges[cellIndex(maze, x, z)] |= direction.edge;
        maze.edges[cellIndex(maze, nextX, nextZ)] |= direction.opposite;
      }
    }
  }
}

function placeSealedPockets(
  maze: Maze,
  random: () => number,
  byZone: Map<number, Vec2[]>,
): void {
  for (const zone of maze.zones) {
    if (maze.sealedPocketZoneIds.length >= GAME_CONFIG.clutter.maxSealedPockets) break;
    const cells = zoneCells(maze, zone);
    const doors = byZone.get(zone.id) ?? [];
    if (
      cells.length === 0 ||
      cells.length > 40 ||
      doors.length !== 1 ||
      random() >= GAME_CONFIG.clutter.sealedPocketChance
    ) {
      continue;
    }
    maze.sealedPocketZoneIds.push(zone.id);
    closePocketBoundaries(maze, zone);
    const count = 2 + Math.floor(random() * 2);
    const door = doors[0];
    for (let placement = 0; placement < count; placement += 1) {
      if (maze.clutter.length >= GAME_CONFIG.clutter.maxInstances) return;
      const rolls = rollPlacement(random);
      const asset = pickFrom(LARGE_ASSETS, rolls.asset);
      const angle = rolls.offset * Math.PI * 2;
      const instance: ClutterInstance = {
        assetId: asset.id,
        x: door.x + 0.5 + Math.cos(angle) * placement * 0.28,
        z: door.z + 0.5 + Math.sin(angle) * placement * 0.28,
        y: 0,
        yaw: rolls.yaw * Math.PI * 2,
        tiltAxis: rolls.tilt < 0.5 ? 0 : 1,
        tiltAngle: placement === 0 ? Math.PI / 2 : 0.12 + rolls.tilt * 0.1,
        scale: 0.95 + rolls.scale * 0.2,
        featureIndex: -1,
      };
      addGroundedInstance(maze, instance, createCollider(maze, asset, instance));
      if (placement === 1 && asset.base) addStackedInstance(maze, instance, asset, rolls);
    }
  }
}

function crossingNeighbors(maze: Maze, door: Vec2): Vec2[] {
  const zoneId = maze.zoneIds[cellIndex(maze, door.x, door.z)];
  return DIRECTIONS.flatMap((direction) => {
    const x = door.x + direction.x;
    const z = door.z + direction.z;
    return canTraverseGrid(maze, door.x, door.z, x, z) &&
      maze.zoneIds[cellIndex(maze, x, z)] !== zoneId
      ? [{ x, z }]
      : [];
  });
}

function gridToWorld(maze: Maze, point: Vec2): Vec2 {
  return {
    x: (point.x - maze.descriptor.width / 2) * maze.descriptor.cellSize,
    z: (point.z - maze.descriptor.height / 2) * maze.descriptor.cellSize,
  };
}

function clearsFeatures(
  maze: Maze,
  point: Vec2,
  radius: number,
  features: readonly OfficeFeature[],
): boolean {
  for (const feature of features) {
    const bounds = featureBounds(feature);
    const worldBounds = {
      minX: (bounds.minX - maze.descriptor.width / 2) * maze.descriptor.cellSize,
      maxX: (bounds.maxX - maze.descriptor.width / 2) * maze.descriptor.cellSize,
      minZ: (bounds.minZ - maze.descriptor.height / 2) * maze.descriptor.cellSize,
      maxZ: (bounds.maxZ - maze.descriptor.height / 2) * maze.descriptor.cellSize,
    };
    const nearestX = Math.max(worldBounds.minX, Math.min(point.x, worldBounds.maxX));
    const nearestZ = Math.max(worldBounds.minZ, Math.min(point.z, worldBounds.maxZ));
    if (Math.hypot(point.x - nearestX, point.z - nearestZ) < radius) return false;
  }
  return true;
}

function canOccupyWithFeatures(
  maze: Maze,
  point: Vec2,
  radius: number,
  features: readonly OfficeFeature[],
): boolean {
  for (const offsetX of [-radius, radius]) {
    for (const offsetZ of [-radius, radius]) {
      const gridX = Math.floor(
        (point.x + offsetX) / maze.descriptor.cellSize + maze.descriptor.width / 2,
      );
      const gridZ = Math.floor(
        (point.z + offsetZ) / maze.descriptor.cellSize + maze.descriptor.height / 2,
      );
      if (!isOpen(maze, gridX, gridZ)) return false;
    }
  }
  return clearsFeatures(maze, point, radius, features);
}

function doorHasFatPathWithFeatures(
  maze: Maze,
  door: Vec2,
  radius: number,
  features: readonly OfficeFeature[],
): boolean {
  const neighbors = crossingNeighbors(maze, door);
  if (neighbors.length === 0) return true;
  const marginCells = (radius + 0.6) / maze.descriptor.cellSize + 0.1;
  const nearbyFeatures = features.filter((feature) => {
    const bounds = featureBounds(feature);
    return (
      bounds.maxX >= door.x - 1 - marginCells &&
      bounds.minX <= door.x + 2 + marginCells &&
      bounds.maxZ >= door.z - 1 - marginCells &&
      bounds.minZ <= door.z + 2 + marginCells
    );
  });
  const start = gridToWorld(maze, { x: door.x + 0.5, z: door.z + 0.5 });
  const offsets = [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6];
  return neighbors.every((neighbor) => {
    const end = gridToWorld(maze, { x: neighbor.x + 0.5, z: neighbor.z + 0.5 });
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz) || 1;
    const perpendicular = { x: -dz / length, z: dx / length };
    return offsets.some((offset) => {
      for (let sample = 0; sample <= 8; sample += 1) {
        const progress = sample / 8;
        const point = {
          x: start.x + dx * progress + perpendicular.x * offset,
          z: start.z + dz * progress + perpendicular.z * offset,
        };
        if (!canOccupyWithFeatures(maze, point, radius, nearbyFeatures)) return false;
      }
      return true;
    });
  });
}

export function doorHasFatPath(
  maze: Maze,
  door: Vec2,
  radius = Math.max(GAME_CONFIG.player.radius, GAME_CONFIG.enemy.radius) + 0.05,
): boolean {
  return doorHasFatPathWithFeatures(maze, door, radius, maze.features);
}

function tryDoorTension(
  maze: Maze,
  zone: OfficeZone,
  doors: Vec2[],
  random: () => number,
  doorMask: Uint8Array,
  protectedCenters: Vec2[],
): void {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rolls = rollPlacement(random);
    const door = pickFrom(doors, rolls.anchor);
    const neighbor = crossingNeighbors(maze, door)[0];
    if (!neighbor) continue;
    const direction = { x: door.x - neighbor.x, z: door.z - neighbor.z };
    const side = rolls.offset < 0.5 ? -1 : 1;
    const perpendicular = { x: -direction.z * side, z: direction.x * side };
    const distance = 1 + rolls.anchor;
    const asset = pickFrom(CLUTTER_ASSETS, rolls.asset);
    const tilt = placementTilt(
      {
        archetype: "sparse",
        index: 0,
        count: 1,
        basis: 0,
        clusterCenter: door,
        forceStack: false,
        forceTopple: false,
      },
      rolls,
    );
    const instance: ClutterInstance = {
      assetId: asset.id,
      x: door.x + 0.5 + direction.x * distance + perpendicular.x * 0.65,
      z: door.z + 0.5 + direction.z * distance + perpendicular.z * 0.65,
      y: 0,
      yaw: rolls.yaw * Math.PI * 2,
      ...tilt,
      scale: 0.85 + rolls.scale * 0.3,
      featureIndex: -1,
    };
    for (let slide = 0; slide < 4; slide += 1) {
      const collider = createCollider(maze, asset, instance);
      if (
        candidateAccepted(
          maze,
          zone,
          collider,
          doorMask,
          protectedCenters,
          true,
        ) &&
        doors.every((zoneDoor) =>
          doorHasFatPathWithFeatures(
            maze,
            zoneDoor,
            Math.max(GAME_CONFIG.player.radius, GAME_CONFIG.enemy.radius) + 0.05,
            [...maze.features, collider],
          ),
        )
      ) {
        addGroundedInstance(maze, instance, collider);
        return;
      }
      instance.x += perpendicular.x * 0.25;
      instance.z += perpendicular.z * 0.25;
    }
  }
}

function reachableMask(maze: Maze): Uint8Array {
  const reachable = new Uint8Array(maze.cells.length);
  let start = -1;
  for (let index = 0; index < maze.cells.length; index += 1) {
    if (
      maze.cells[index] &&
      !maze.sealedPocketZoneIds.includes((maze.zoneIds[index] || 1) - 1)
    ) {
      start = index;
      break;
    }
  }
  if (start < 0) return reachable;
  const queue = new Int32Array(maze.cells.length);
  queue[0] = start;
  reachable[start] = 1;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const current = queue[head++];
    const x = current % maze.descriptor.width;
    const z = Math.floor(current / maze.descriptor.width);
    for (const direction of DIRECTIONS) {
      const nextX = x + direction.x;
      const nextZ = z + direction.z;
      if (!canTraverseGrid(maze, x, z, nextX, nextZ)) continue;
      const next = cellIndex(maze, nextX, nextZ);
      if (reachable[next]) continue;
      reachable[next] = 1;
      queue[tail++] = next;
    }
  }
  return reachable;
}

function allNonPocketCellsReachable(maze: Maze): boolean {
  const reachable = reachableMask(maze);
  for (let index = 0; index < maze.cells.length; index += 1) {
    if (!maze.cells[index]) continue;
    const zoneId = (maze.zoneIds[index] || 1) - 1;
    if (!maze.sealedPocketZoneIds.includes(zoneId) && !reachable[index]) return false;
  }
  return true;
}

function removeClutterFeature(maze: Maze, featureIndex: number): void {
  const base = maze.clutter.find((instance) => instance.featureIndex === featureIndex);
  maze.clutter = maze.clutter.filter(
    (instance) =>
      instance.featureIndex !== featureIndex &&
      !(
        instance.featureIndex === -1 &&
        base &&
        Math.abs(instance.x - base.x) < 0.2 &&
        Math.abs(instance.z - base.z) < 0.2
      ),
  );
  maze.features.splice(featureIndex, 1);
  for (const instance of maze.clutter) {
    if (instance.featureIndex > featureIndex) instance.featureIndex -= 1;
  }
}

function largestClutterInCell(maze: Maze, x: number, z: number): number {
  const cellBounds = { minX: x, maxX: x + 1, minZ: z, maxZ: z + 1 };
  let bestIndex = -1;
  let bestArea = 0;
  for (let index = 0; index < maze.features.length; index += 1) {
    const feature = maze.features[index];
    if (feature.kind !== "clutter") continue;
    const area = overlapArea(cellBounds, featureBounds(feature));
    if (area > bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function affectedCells(maze: Maze): number[] {
  const affected = new Set<number>();
  for (const feature of maze.features) {
    if (feature.kind !== "clutter") continue;
    const bounds = featureBounds(feature);
    for (
      let z = Math.max(0, Math.floor(bounds.minZ) - 1);
      z <= Math.min(maze.descriptor.height - 1, Math.floor(bounds.maxZ) + 1);
      z += 1
    ) {
      for (
        let x = Math.max(0, Math.floor(bounds.minX) - 1);
        x <= Math.min(maze.descriptor.width - 1, Math.floor(bounds.maxX) + 1);
        x += 1
      ) {
        affected.add(cellIndex(maze, x, z));
      }
    }
  }
  return [...affected].sort((left, right) => left - right);
}

function cellClosurePass(maze: Maze, doorMask: Uint8Array): boolean {
  let changed = false;
  for (const index of affectedCells(maze)) {
    if (!maze.cells[index] || doorMask[index]) continue;
    const zoneId = (maze.zoneIds[index] || 1) - 1;
    if (maze.sealedPocketZoneIds.includes(zoneId)) continue;
    const x = index % maze.descriptor.width;
    const z = Math.floor(index / maze.descriptor.width);
    let free = cellFreeAxes(maze, x, z);
    if (
      free.horizontal >= GAME_CONFIG.clutter.navClearanceMeters ||
      free.vertical >= GAME_CONFIG.clutter.navClearanceMeters
    ) {
      continue;
    }
    maze.cells[index] = 0;
    if (allNonPocketCellsReachable(maze)) {
      changed = true;
      continue;
    }
    maze.cells[index] = 1;
    const featureIndex = largestClutterInCell(maze, x, z);
    if (featureIndex < 0) continue;
    const feature = maze.features[featureIndex];
    for (let shrink = 0; shrink < 3; shrink += 1) {
      feature.width *= 0.85;
      feature.depth *= 0.85;
      free = cellFreeAxes(maze, x, z);
      if (
        free.horizontal >= GAME_CONFIG.clutter.navClearanceMeters ||
        free.vertical >= GAME_CONFIG.clutter.navClearanceMeters
      ) {
        changed = true;
        break;
      }
    }
    if (
      free.horizontal < GAME_CONFIG.clutter.navClearanceMeters &&
      free.vertical < GAME_CONFIG.clutter.navClearanceMeters
    ) {
      removeClutterFeature(maze, featureIndex);
      changed = true;
    }
  }
  return changed;
}

function nearestClutterToDoor(maze: Maze, door: Vec2): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < maze.features.length; index += 1) {
    const feature = maze.features[index];
    if (feature.kind !== "clutter") continue;
    const distance = Math.hypot(feature.x - (door.x + 0.5), feature.z - (door.z + 0.5));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function repairDoorPaths(maze: Maze): boolean {
  let changed = false;
  const radius = Math.max(GAME_CONFIG.player.radius, GAME_CONFIG.enemy.radius) + 0.05;
  for (const door of maze.doorCells) {
    const zoneId = (maze.zoneIds[cellIndex(maze, door.x, door.z)] || 1) - 1;
    if (maze.sealedPocketZoneIds.includes(zoneId) || doorHasFatPath(maze, door, radius)) {
      continue;
    }
    const featureIndex = nearestClutterToDoor(maze, door);
    if (featureIndex < 0) {
      throw new Error(`Door ${door.x},${door.z} has no navigable fat path.`);
    }
    const feature = maze.features[featureIndex];
    for (let shrink = 0; shrink < 3 && !doorHasFatPath(maze, door, radius); shrink += 1) {
      feature.width *= 0.85;
      feature.depth *= 0.85;
      changed = true;
    }
    if (!doorHasFatPath(maze, door, radius)) {
      removeClutterFeature(maze, featureIndex);
      changed = true;
    }
  }
  return changed;
}

function validatePlacement(maze: Maze, doorMask: Uint8Array): void {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const cellsChanged = cellClosurePass(maze, doorMask);
    const doorsChanged = repairDoorPaths(maze);
    if (!allNonPocketCellsReachable(maze)) {
      throw new Error("Clutter validation disconnected a non-pocket office region.");
    }
    const allDoorsPass = maze.doorCells.every((door) => {
      const zoneId = (maze.zoneIds[cellIndex(maze, door.x, door.z)] || 1) - 1;
      return maze.sealedPocketZoneIds.includes(zoneId) || doorHasFatPath(maze, door);
    });
    if (allDoorsPass && !cellsChanged && !doorsChanged) return;
  }
  throw new Error("Clutter validation exceeded 20 iterations.");
}

export function placeClutter(maze: Maze, random: () => number): void {
  const { doorMask, byZone } = extractDoorCells(maze);
  placeSealedPockets(maze, random, byZone);
  const protectedCenters = maze.zones.flatMap((zone) => {
    if (maze.sealedPocketZoneIds.includes(zone.id)) return [];
    const cells = zoneCells(maze, zone);
    if (cells.length === 0) return [];
    const center = nearestOpenToCenter(cells, zone);
    return [{ x: center.x + 0.5, z: center.z + 0.5 }];
  });
  protectedCenters.push({ x: maze.enemySpawnCell.x + 0.5, z: maze.enemySpawnCell.z + 0.5 });

  for (const zone of [...maze.zones].sort((left, right) => left.id - right.id)) {
    if (
      maze.clutter.length >= GAME_CONFIG.clutter.maxInstances ||
      maze.sealedPocketZoneIds.includes(zone.id)
    ) {
      continue;
    }
    const cells = zoneCells(maze, zone);
    if (cells.length === 0) continue;
    let archetype = rollArchetype(random);
    if ((archetype === "cluster" || archetype === "swallowed") && cells.length < 24) {
      archetype = "sparse";
    }
    const count =
      archetype === "empty"
        ? 0
        : archetype === "sparse"
          ? 1 + Math.floor(random() * 3)
          : archetype === "cluster"
            ? 3 + Math.floor(random() * 3)
            : archetype === "barricade"
              ? 2 + Math.floor(random() * 3)
              : 5 + Math.floor(random() * 4);
    const basis = count > 0 ? random() * Math.PI * 2 : 0;
    const clusterAnchor = count > 0
      ? selectAnchor(maze, zone, cells, rollPlacement(random))
      : nearestOpenToCenter(cells, zone);
    const clusterCenter = { x: clusterAnchor.x + 0.5, z: clusterAnchor.z + 0.5 };
    const wantsClusterStack = archetype === "cluster" && random() < 0.3;
    const wantsIntersection = archetype === "cluster" && random() < 0.4;
    const barricadeTiltIndex =
      archetype === "barricade" && random() < 0.6 ? Math.floor(random() * count) : -1;
    const swallowedStacks =
      archetype === "swallowed" ? 1 + Math.floor(random() * 2) : 0;
    const placed: ClutterInstance[] = [];

    for (let placement = 0; placement < count; placement += 1) {
      if (maze.clutter.length >= GAME_CONFIG.clutter.maxInstances) break;
      const forceStack =
        (wantsClusterStack && placement === 0) ||
        (archetype === "swallowed" && placement < swallowedStacks);
      const intersectionTarget =
        (wantsIntersection && placement === 1 && placed[0]) ||
        (archetype === "swallowed" && (placement === 1 || placement === 3)
          ? placed[Math.max(0, placement - 1)]
          : undefined);
      const instance = tryPlacement(
        maze,
        zone,
        cells,
        {
          archetype,
          index: placement,
          count,
          basis,
          clusterCenter,
          intersectionTarget,
          forceStack,
          forceTopple:
            placement === barricadeTiltIndex ||
            (archetype === "swallowed" && placement === 0),
        },
        random,
        doorMask,
        protectedCenters,
      );
      if (instance) placed.push(instance);
    }

    const doorTensionRoll = random();
    const doors = byZone.get(zone.id) ?? [];
    if (
      archetype !== "empty" &&
      doors.length > 0 &&
      doorTensionRoll < 0.35 &&
      maze.clutter.length < GAME_CONFIG.clutter.maxInstances
    ) {
      tryDoorTension(maze, zone, doors, random, doorMask, protectedCenters);
    }
  }

  validatePlacement(maze, doorMask);
}
