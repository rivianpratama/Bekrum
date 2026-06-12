import { GAME_CONFIG } from "../shared/config";
import type { MazeDescriptor, Vec2 } from "../shared/types";
import { createRandom } from "./random";

export const Edge = {
  North: 1,
  East: 2,
  South: 4,
  West: 8,
} as const;

export type OfficeFeatureKind = "wall" | "divider" | "counter" | "pillar";

export interface OfficeFeature {
  kind: OfficeFeatureKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  blocksSight: boolean;
}

export interface OfficeZone {
  id: number;
  x: number;
  z: number;
  width: number;
  height: number;
}

export interface Maze {
  descriptor: MazeDescriptor;
  cells: Uint8Array;
  edges: Uint8Array;
  zoneIds: Uint16Array;
  zones: OfficeZone[];
  features: OfficeFeature[];
  featureGrid: Map<number, OfficeFeature[]>;
  spawnCells: Vec2[];
  enemySpawnCell: Vec2;
}

interface Rect {
  x: number;
  z: number;
  width: number;
  height: number;
}

type Opening = readonly [start: number, end: number];

interface PartitionAlcove {
  start: number;
  end: number;
  depth: number;
  side: -1 | 1;
}

const DIRECTIONS = [
  { x: 0, z: -1, edge: Edge.North, opposite: Edge.South },
  { x: 1, z: 0, edge: Edge.East, opposite: Edge.West },
  { x: 0, z: 1, edge: Edge.South, opposite: Edge.North },
  { x: -1, z: 0, edge: Edge.West, opposite: Edge.East },
] as const;

function index(width: number, x: number, z: number): number {
  return z * width + x;
}

function hashMap(
  cells: Uint8Array,
  edges: Uint8Array,
  zoneIds: Uint16Array,
  features: OfficeFeature[],
  spawnCells: Vec2[],
  enemySpawnCell: Vec2,
): string {
  let hash = 2166136261;
  const add = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 16777619);
  };
  cells.forEach(add);
  edges.forEach(add);
  for (const zoneId of zoneIds) {
    add(zoneId);
    add(zoneId >>> 8);
  }
  for (const feature of features) {
    for (const value of [
      feature.kind.length,
      feature.x,
      feature.z,
      feature.width,
      feature.depth,
      feature.height,
      Number(feature.blocksSight),
    ]) {
      const quantized = Math.round(value * 100);
      add(quantized);
      add(quantized >>> 8);
      add(quantized >>> 16);
    }
  }
  for (const spawn of [...spawnCells, enemySpawnCell]) {
    add(spawn.x);
    add(spawn.x >>> 8);
    add(spawn.z);
    add(spawn.z >>> 8);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function setBoundary(
  edges: Uint8Array,
  width: number,
  height: number,
  x: number,
  z: number,
  direction: (typeof DIRECTIONS)[number],
): void {
  if (x < 0 || z < 0 || x >= width || z >= height) return;
  edges[index(width, x, z)] |= direction.edge;
  const nextX = x + direction.x;
  const nextZ = z + direction.z;
  if (nextX >= 0 && nextZ >= 0 && nextX < width && nextZ < height) {
    edges[index(width, nextX, nextZ)] |= direction.opposite;
  }
}

function clearBoundary(
  edges: Uint8Array,
  width: number,
  height: number,
  x: number,
  z: number,
  direction: (typeof DIRECTIONS)[number],
): void {
  if (x < 0 || z < 0 || x >= width || z >= height) return;
  edges[index(width, x, z)] &= ~direction.edge;
  const nextX = x + direction.x;
  const nextZ = z + direction.z;
  if (nextX >= 0 && nextZ >= 0 && nextX < width && nextZ < height) {
    edges[index(width, nextX, nextZ)] &= ~direction.opposite;
  }
}

function featureHeight(kind: OfficeFeatureKind): number {
  return kind === "wall"
    ? GAME_CONFIG.maze.wallHeight
    : kind === "counter"
      ? 1.15
      : 1.45;
}

function isInOpening(position: number, openings: Opening[]): boolean {
  return openings.some(([start, end]) => position >= start && position < end);
}

function addVerticalPartition(
  features: OfficeFeature[],
  edges: Uint8Array,
  width: number,
  height: number,
  x: number,
  startZ: number,
  endZ: number,
  openings: Opening[] = [],
  kind: "wall" | "divider" | "counter" = "wall",
  alcove?: PartitionAlcove,
): void {
  let segmentStart = startZ;
  const flush = (segmentEnd: number) => {
    if (segmentEnd <= segmentStart) return;
    features.push({
      kind,
      x,
      z: (segmentStart + segmentEnd) / 2,
      width: 0.16,
      depth: segmentEnd - segmentStart,
      height: featureHeight(kind),
      blocksSight: kind === "wall",
    });
  };
  for (let z = startZ; z < endZ; z += 1) {
    if (isInOpening(z, openings) || (alcove && z >= alcove.start && z < alcove.end)) {
      flush(z);
      segmentStart = z + 1;
      continue;
    }
    setBoundary(edges, width, height, x - 1, z, DIRECTIONS[1]);
  }
  flush(endZ);
  if (!alcove) return;

  const backX = x + alcove.side * alcove.depth;
  features.push(
    {
      kind: "wall",
      x: backX,
      z: (alcove.start + alcove.end) / 2,
      width: 0.16,
      depth: alcove.end - alcove.start,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
    {
      kind: "wall",
      x: (x + backX) / 2,
      z: alcove.start,
      width: alcove.depth,
      depth: 0.16,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
    {
      kind: "wall",
      x: (x + backX) / 2,
      z: alcove.end,
      width: alcove.depth,
      depth: 0.16,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
  );
  const backCellX = alcove.side > 0 ? backX - 1 : backX;
  const backDirection = alcove.side > 0 ? DIRECTIONS[1] : DIRECTIONS[3];
  for (let z = alcove.start; z < alcove.end; z += 1) {
    setBoundary(edges, width, height, backCellX, z, backDirection);
  }
  const returnStartX = Math.min(x, backX);
  for (let returnX = returnStartX; returnX < returnStartX + alcove.depth; returnX += 1) {
    setBoundary(edges, width, height, returnX, alcove.start - 1, DIRECTIONS[2]);
    setBoundary(edges, width, height, returnX, alcove.end - 1, DIRECTIONS[2]);
  }
}

function addHorizontalPartition(
  features: OfficeFeature[],
  edges: Uint8Array,
  width: number,
  height: number,
  z: number,
  startX: number,
  endX: number,
  openings: Opening[] = [],
  kind: "wall" | "divider" | "counter" = "wall",
  alcove?: PartitionAlcove,
): void {
  let segmentStart = startX;
  const flush = (segmentEnd: number) => {
    if (segmentEnd <= segmentStart) return;
    features.push({
      kind,
      x: (segmentStart + segmentEnd) / 2,
      z,
      width: segmentEnd - segmentStart,
      depth: 0.16,
      height: featureHeight(kind),
      blocksSight: kind === "wall",
    });
  };
  for (let x = startX; x < endX; x += 1) {
    if (isInOpening(x, openings) || (alcove && x >= alcove.start && x < alcove.end)) {
      flush(x);
      segmentStart = x + 1;
      continue;
    }
    setBoundary(edges, width, height, x, z - 1, DIRECTIONS[2]);
  }
  flush(endX);
  if (!alcove) return;

  const backZ = z + alcove.side * alcove.depth;
  features.push(
    {
      kind: "wall",
      x: (alcove.start + alcove.end) / 2,
      z: backZ,
      width: alcove.end - alcove.start,
      depth: 0.16,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
    {
      kind: "wall",
      x: alcove.start,
      z: (z + backZ) / 2,
      width: 0.16,
      depth: alcove.depth,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
    {
      kind: "wall",
      x: alcove.end,
      z: (z + backZ) / 2,
      width: 0.16,
      depth: alcove.depth,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
  );
  const backCellZ = alcove.side > 0 ? backZ - 1 : backZ;
  const backDirection = alcove.side > 0 ? DIRECTIONS[2] : DIRECTIONS[0];
  for (let x = alcove.start; x < alcove.end; x += 1) {
    setBoundary(edges, width, height, x, backCellZ, backDirection);
  }
  const returnStartZ = Math.min(z, backZ);
  for (let returnZ = returnStartZ; returnZ < returnStartZ + alcove.depth; returnZ += 1) {
    setBoundary(edges, width, height, alcove.start - 1, returnZ, DIRECTIONS[1]);
    setBoundary(edges, width, height, alcove.end - 1, returnZ, DIRECTIONS[1]);
  }
}

function openingsOverlap(start: number, end: number, openings: Opening[]): boolean {
  return openings.some(([openingStart, openingEnd]) => start < openingEnd && end > openingStart);
}

function rollAlcove(
  random: () => number,
  wallStart: number,
  wallEnd: number,
  openings: Opening[],
  negativeRoom: number,
  positiveRoom: number,
): PartitionAlcove | undefined {
  const chance = random();
  const positionRoll = random();
  const alcoveWidth = 2 + Math.floor(random() * 2);
  const depth = random() < 0.6 ? 1 : 2;
  const preferredSide: -1 | 1 = random() < 0.5 ? -1 : 1;
  if (chance >= GAME_CONFIG.maze.alcoveDensity) return undefined;

  const minimumStart = wallStart + 2;
  const maximumStart = wallEnd - alcoveWidth - 2;
  if (maximumStart < minimumStart) return undefined;
  const candidates: number[] = [];
  const candidateCount = maximumStart - minimumStart + 1;
  const rolledStart = minimumStart + Math.floor(positionRoll * candidateCount);
  for (let offset = 0; offset < candidateCount; offset += 1) {
    const candidate = minimumStart + ((rolledStart - minimumStart + offset) % candidateCount);
    if (!openingsOverlap(candidate, candidate + alcoveWidth, openings)) candidates.push(candidate);
  }
  if (candidates.length === 0) return undefined;

  const side =
    preferredSide < 0 && negativeRoom >= depth + 2
      ? -1
      : preferredSide > 0 && positiveRoom >= depth + 2
        ? 1
        : negativeRoom >= depth + 2
          ? -1
          : positiveRoom >= depth + 2
            ? 1
            : 0;
  if (side === 0) return undefined;
  return {
    start: candidates[0],
    end: candidates[0] + alcoveWidth,
    depth,
    side,
  };
}

function hasPerpendicularBoundary(
  edges: Uint8Array,
  width: number,
  height: number,
  vertical: boolean,
  line: number,
  start: number,
  end: number,
): boolean {
  for (let along = start - 1; along <= end; along += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const x = vertical ? line + offset : along;
      const z = vertical ? along : line + offset;
      if (x < 0 || z < 0 || x >= width || z >= height) continue;
      const perpendicularBits = vertical
        ? Edge.North | Edge.South
        : Edge.East | Edge.West;
      if ((edges[index(width, x, z)] & perpendicularBits) !== 0) return true;
    }
  }
  return false;
}

function addDoorBaffles(
  features: OfficeFeature[],
  edges: Uint8Array,
  width: number,
  height: number,
  parent: Rect,
  vertical: boolean,
  partitionLine: number,
  openings: Opening[],
  splitIndex: number,
  random: () => number,
): void {
  openings.forEach(([openingStart, openingEnd], openingIndex) => {
    const addBaffle = random() < GAME_CONFIG.maze.doorJogChance;
    const randomFlip = random() < 0.5;
    if (!addBaffle) return;
    const baseSide = (splitIndex + openingIndex) % 2 === 0 ? -1 : 1;
    const side = randomFlip ? -baseSide : baseSide;
    const openingWidth = openingEnd - openingStart;
    const baffleStart = Math.floor((openingStart + openingEnd - (openingWidth + 1)) / 2);
    const baffleEnd = baffleStart + openingWidth + 1;
    const line = partitionLine + side;
    if (vertical) {
      if (
        line <= parent.x ||
        line >= parent.x + parent.width ||
        baffleStart <= parent.z ||
        baffleEnd >= parent.z + parent.height ||
        hasPerpendicularBoundary(edges, width, height, true, line, baffleStart, baffleEnd)
      ) {
        return;
      }
      addVerticalPartition(
        features,
        edges,
        width,
        height,
        line,
        baffleStart,
        baffleEnd,
      );
    } else {
      if (
        line <= parent.z ||
        line >= parent.z + parent.height ||
        baffleStart <= parent.x ||
        baffleEnd >= parent.x + parent.width ||
        hasPerpendicularBoundary(edges, width, height, false, line, baffleStart, baffleEnd)
      ) {
        return;
      }
      addHorizontalPartition(
        features,
        edges,
        width,
        height,
        line,
        baffleStart,
        baffleEnd,
      );
    }
  });
}

function reachableMask(
  cells: Uint8Array,
  edges: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const reachable = new Uint8Array(cells.length);
  const start = cells.findIndex((cell) => cell === 1);
  if (start < 0) return reachable;
  const queue = new Int32Array(cells.length);
  let head = 0;
  let tail = 1;
  queue[0] = start;
  reachable[start] = 1;
  while (head < tail) {
    const current = queue[head++];
    const x = current % width;
    const z = Math.floor(current / width);
    for (const direction of DIRECTIONS) {
      const nextX = x + direction.x;
      const nextZ = z + direction.z;
      if (nextX < 0 || nextZ < 0 || nextX >= width || nextZ >= height) continue;
      const next = index(width, nextX, nextZ);
      if (
        reachable[next] ||
        cells[next] === 0 ||
        (edges[current] & direction.edge) !== 0
      ) {
        continue;
      }
      reachable[next] = 1;
      queue[tail++] = next;
    }
  }
  return reachable;
}

function removeFeatureSpan(
  features: OfficeFeature[],
  vertical: boolean,
  line: number,
  spanStart: number,
): void {
  const featureIndex = features.findIndex((feature) => {
    if (vertical) {
      return (
        feature.width <= 0.2 &&
        Math.abs(feature.x - line) < 0.001 &&
        spanStart >= feature.z - feature.depth / 2 - 0.001 &&
        spanStart + 1 <= feature.z + feature.depth / 2 + 0.001
      );
    }
    return (
      feature.depth <= 0.2 &&
      Math.abs(feature.z - line) < 0.001 &&
      spanStart >= feature.x - feature.width / 2 - 0.001 &&
      spanStart + 1 <= feature.x + feature.width / 2 + 0.001
    );
  });
  if (featureIndex < 0) return;
  const feature = features[featureIndex];
  const featureStart = vertical
    ? feature.z - feature.depth / 2
    : feature.x - feature.width / 2;
  const featureEnd = vertical
    ? feature.z + feature.depth / 2
    : feature.x + feature.width / 2;
  const replacements: OfficeFeature[] = [];
  const addSegment = (start: number, end: number) => {
    if (end - start <= 0.001) return;
    replacements.push(
      vertical
        ? { ...feature, z: (start + end) / 2, depth: end - start }
        : { ...feature, x: (start + end) / 2, width: end - start },
    );
  };
  addSegment(featureStart, spanStart);
  addSegment(spanStart + 1, featureEnd);
  features.splice(featureIndex, 1, ...replacements);
}

function repairConnectivity(
  cells: Uint8Array,
  edges: Uint8Array,
  features: OfficeFeature[],
  width: number,
  height: number,
): void {
  for (let repair = 0; repair < 200; repair += 1) {
    const reachable = reachableMask(cells, edges, width, height);
    let unreachable = -1;
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      if (cells[cellIndex] === 1 && reachable[cellIndex] === 0) {
        unreachable = cellIndex;
        break;
      }
    }
    if (unreachable < 0) return;

    let repaired = false;
    for (let cellIndex = 0; cellIndex < cells.length && !repaired; cellIndex += 1) {
      if (cells[cellIndex] === 0 || reachable[cellIndex] === 0) continue;
      const x = cellIndex % width;
      const z = Math.floor(cellIndex / width);
      for (const direction of DIRECTIONS) {
        const nextX = x + direction.x;
        const nextZ = z + direction.z;
        if (nextX < 0 || nextZ < 0 || nextX >= width || nextZ >= height) continue;
        const next = index(width, nextX, nextZ);
        if (
          cells[next] === 1 &&
          reachable[next] === 0 &&
          (edges[cellIndex] & direction.edge) !== 0
        ) {
          clearBoundary(edges, width, height, x, z, direction);
          const vertical = direction.x !== 0;
          removeFeatureSpan(
            features,
            vertical,
            vertical ? Math.max(x, nextX) : Math.max(z, nextZ),
            vertical ? z : x,
          );
          repaired = true;
          break;
        }
      }
    }
    if (repaired) continue;

    for (let cellIndex = 0; cellIndex < cells.length && !repaired; cellIndex += 1) {
      if (cells[cellIndex] !== 0) continue;
      const x = cellIndex % width;
      const z = Math.floor(cellIndex / width);
      let touchesReachable = false;
      let touchesUnreachable = false;
      for (const direction of DIRECTIONS) {
        const nextX = x + direction.x;
        const nextZ = z + direction.z;
        if (nextX < 0 || nextZ < 0 || nextX >= width || nextZ >= height) continue;
        const next = index(width, nextX, nextZ);
        touchesReachable ||= cells[next] === 1 && reachable[next] === 1;
        touchesUnreachable ||= cells[next] === 1 && reachable[next] === 0;
      }
      if (!touchesReachable || !touchesUnreachable) continue;
      cells[cellIndex] = 1;
      const pillarIndex = features.findIndex(
        (feature) =>
          feature.kind === "pillar" &&
          Math.abs(feature.x - (x + 0.5)) < 0.001 &&
          Math.abs(feature.z - (z + 0.5)) < 0.001,
      );
      if (pillarIndex >= 0) features.splice(pillarIndex, 1);
      repaired = true;
    }
    if (!repaired) {
      throw new Error(`Unable to repair disconnected office region at cell ${unreachable}.`);
    }
  }
  throw new Error("Office connectivity repair exceeded 200 iterations.");
}

function buildFeatureGrid(
  features: OfficeFeature[],
  width: number,
  height: number,
): Map<number, OfficeFeature[]> {
  const featureGrid = new Map<number, OfficeFeature[]>();
  for (const feature of features) {
    const minimumX = Math.max(0, Math.floor(feature.x - feature.width / 2 - 1));
    const maximumX = Math.min(width - 1, Math.floor(feature.x + feature.width / 2 + 1));
    const minimumZ = Math.max(0, Math.floor(feature.z - feature.depth / 2 - 1));
    const maximumZ = Math.min(height - 1, Math.floor(feature.z + feature.depth / 2 + 1));
    for (let z = minimumZ; z <= maximumZ; z += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const bucket = featureGrid.get(index(width, x, z)) ?? [];
        bucket.push(feature);
        featureGrid.set(index(width, x, z), bucket);
      }
    }
  }
  return featureGrid;
}

function nearestOpenCell(maze: Pick<Maze, "cells" | "descriptor">, target: Vec2): Vec2 {
  const { width, height } = maze.descriptor;
  for (let radius = 0; radius < Math.max(width, height); radius += 1) {
    for (let z = Math.max(1, target.z - radius); z <= Math.min(height - 2, target.z + radius); z += 1) {
      for (let x = Math.max(1, target.x - radius); x <= Math.min(width - 2, target.x + radius); x += 1) {
        if (Math.abs(x - target.x) + Math.abs(z - target.z) !== radius) continue;
        if (maze.cells[index(width, x, z)]) return { x, z };
      }
    }
  }
  return { x: 1, z: 1 };
}

function distanceField(maze: Maze, start: Vec2): Int32Array {
  const { width, height } = maze.descriptor;
  const distances = new Int32Array(width * height);
  distances.fill(-1);
  const queueX = new Int16Array(width * height);
  const queueZ = new Int16Array(width * height);
  let head = 0;
  let tail = 0;
  queueX[tail] = start.x;
  queueZ[tail] = start.z;
  tail += 1;
  distances[index(width, start.x, start.z)] = 0;
  while (head < tail) {
    const x = queueX[head];
    const z = queueZ[head];
    head += 1;
    for (const direction of DIRECTIONS) {
      const nextX = x + direction.x;
      const nextZ = z + direction.z;
      if (
        nextX < 0 ||
        nextZ < 0 ||
        nextX >= width ||
        nextZ >= height ||
        !canTraverse(maze, x, z, nextX, nextZ)
      ) {
        continue;
      }
      const nextIndex = index(width, nextX, nextZ);
      if (distances[nextIndex] !== -1) continue;
      distances[nextIndex] = distances[index(width, x, z)] + 1;
      queueX[tail] = nextX;
      queueZ[tail] = nextZ;
      tail += 1;
    }
  }
  return distances;
}

export function navigationDistance(maze: Maze, start: Vec2, goal: Vec2): number {
  return distanceField(maze, start)[index(maze.descriptor.width, goal.x, goal.z)];
}

export function chooseEnemySpawn(maze: Maze, playerSpawns: Vec2[]): Vec2 {
  const fields = playerSpawns.map((spawn) => distanceField(maze, spawn));
  let best = maze.enemySpawnCell;
  let bestDistance = -1;
  for (const zone of maze.zones) {
    const candidate = nearestOpenCell(maze, {
      x: Math.floor(zone.x + zone.width / 2),
      z: Math.floor(zone.z + zone.height / 2),
    });
    const candidateIndex = index(maze.descriptor.width, candidate.x, candidate.z);
    const minimumDistance = Math.min(...fields.map((field) => field[candidateIndex]));
    if (minimumDistance > bestDistance) {
      bestDistance = minimumDistance;
      best = candidate;
    }
  }
  return best;
}

function chooseSpawns(maze: Maze, random: () => number): { players: Vec2[]; enemy: Vec2 } {
  const candidates = maze.zones.map((zone) =>
    nearestOpenCell(maze, {
      x: Math.floor(zone.x + zone.width / 2),
      z: Math.floor(zone.z + zone.height / 2),
    }),
  );
  const selected: Vec2[] = [candidates[Math.floor(random() * candidates.length)]];
  const fields = [distanceField(maze, selected[0])];
  while (selected.length < GAME_CONFIG.room.maxPlayers) {
    let best = candidates[0];
    let bestDistance = -1;
    for (const candidate of candidates) {
      if (selected.some((spawn) => spawn.x === candidate.x && spawn.z === candidate.z)) continue;
      const candidateIndex = index(maze.descriptor.width, candidate.x, candidate.z);
      const minimumDistance = Math.min(...fields.map((field) => field[candidateIndex]));
      if (minimumDistance > bestDistance) {
        bestDistance = minimumDistance;
        best = candidate;
      }
    }
    selected.push(best);
    fields.push(distanceField(maze, best));
  }

  const enemy = chooseEnemySpawn(maze, selected);
  return { players: selected, enemy };
}

export function generateMaze(
  seed: number,
  width: number = GAME_CONFIG.maze.width,
  height: number = GAME_CONFIG.maze.height,
): Maze {
  const safeWidth = Math.max(31, width | 1);
  const safeHeight = Math.max(31, height | 1);
  const random = createRandom(seed);
  const cells = new Uint8Array(safeWidth * safeHeight);
  const edges = new Uint8Array(safeWidth * safeHeight);
  const zoneIds = new Uint16Array(safeWidth * safeHeight);
  const features: OfficeFeature[] = [];
  const leaves: Rect[] = [{ x: 1, z: 1, width: safeWidth - 2, height: safeHeight - 2 }];

  for (let z = 1; z < safeHeight - 1; z += 1) {
    for (let x = 1; x < safeWidth - 1; x += 1) cells[index(safeWidth, x, z)] = 1;
  }
  for (let x = 1; x < safeWidth - 1; x += 1) {
    setBoundary(edges, safeWidth, safeHeight, x, 1, DIRECTIONS[0]);
    setBoundary(edges, safeWidth, safeHeight, x, safeHeight - 2, DIRECTIONS[2]);
  }
  for (let z = 1; z < safeHeight - 1; z += 1) {
    setBoundary(edges, safeWidth, safeHeight, 1, z, DIRECTIONS[3]);
    setBoundary(edges, safeWidth, safeHeight, safeWidth - 2, z, DIRECTIONS[1]);
  }
  features.push(
    {
      kind: "wall",
      x: safeWidth / 2,
      z: 1,
      width: safeWidth - 2,
      depth: 0.16,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
    {
      kind: "wall",
      x: safeWidth / 2,
      z: safeHeight - 1,
      width: safeWidth - 2,
      depth: 0.16,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
    {
      kind: "wall",
      x: 1,
      z: safeHeight / 2,
      width: 0.16,
      depth: safeHeight - 2,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
    {
      kind: "wall",
      x: safeWidth - 1,
      z: safeHeight / 2,
      width: 0.16,
      depth: safeHeight - 2,
      height: GAME_CONFIG.maze.wallHeight,
      blocksSight: true,
    },
  );

  while (leaves.length < GAME_CONFIG.maze.majorZones) {
    const eligible = leaves
      .map((rect, leafIndex) => ({ rect, leafIndex, area: rect.width * rect.height }))
      .filter(
        ({ rect }) =>
          rect.width >= GAME_CONFIG.maze.minimumZoneCells * 2 ||
          rect.height >= GAME_CONFIG.maze.minimumZoneCells * 2,
      )
      .sort((left, right) => right.area - left.area);
    if (eligible.length === 0) break;
    const pick = eligible[Math.floor(random() * Math.min(4, eligible.length))];
    const rect = pick.rect;
    const splitVertical =
      rect.width / rect.height > 1.2
        ? true
        : rect.height / rect.width > 1.2
          ? false
          : random() > 0.5;
    const size = splitVertical ? rect.width : rect.height;
    const minimum = GAME_CONFIG.maze.minimumZoneCells;
    const jitter = Math.floor((random() - 0.5) * Math.min(8, size * 0.2));
    const split = Math.max(minimum, Math.min(size - minimum, Math.floor(size / 2) + jitter));
    const connector = 1 + Math.floor(random() * GAME_CONFIG.maze.connectorWidthCells);
    const splitIndex = leaves.length - 1;
    leaves.splice(pick.leafIndex, 1);
    if (splitVertical) {
      const splitX = rect.x + split;
      const openingStart =
        rect.z + 2 + Math.floor(random() * Math.max(1, rect.height - connector - 4));
      const openings: Opening[] = [[openingStart, openingStart + connector]];
      if (rect.height >= 18 && random() < GAME_CONFIG.maze.openness * 0.55) {
        const secondWidth =
          1 + Math.floor(random() * GAME_CONFIG.maze.connectorWidthCells);
        const secondStart =
          openingStart < rect.z + rect.height / 2
            ? rect.z + rect.height - secondWidth - 2
            : rect.z + 2;
        if (!openingsOverlap(secondStart, secondStart + secondWidth, openings)) {
          openings.push([secondStart, secondStart + secondWidth]);
        }
      }
      if (random() < GAME_CONFIG.maze.bonusConnectorChance) {
        const nearStart = random() < 0.5;
        const cornerOffset = 2 + Math.floor(random() * 2);
        const bonusStart = nearStart
          ? rect.z + cornerOffset
          : rect.z + rect.height - cornerOffset - 1;
        if (!openingsOverlap(bonusStart, bonusStart + 1, openings)) {
          openings.push([bonusStart, bonusStart + 1]);
        }
      }
      const alcove = rollAlcove(
        random,
        rect.z,
        rect.z + rect.height,
        openings,
        split,
        rect.width - split,
      );
      addVerticalPartition(
        features,
        edges,
        safeWidth,
        safeHeight,
        splitX,
        rect.z,
        rect.z + rect.height,
        openings,
        "wall",
        alcove,
      );
      addDoorBaffles(
        features,
        edges,
        safeWidth,
        safeHeight,
        rect,
        true,
        splitX,
        openings,
        splitIndex,
        random,
      );
      leaves.push(
        { x: rect.x, z: rect.z, width: split, height: rect.height },
        { x: splitX, z: rect.z, width: rect.width - split, height: rect.height },
      );
    } else {
      const splitZ = rect.z + split;
      const openingStart =
        rect.x + 2 + Math.floor(random() * Math.max(1, rect.width - connector - 4));
      const openings: Opening[] = [[openingStart, openingStart + connector]];
      if (rect.width >= 18 && random() < GAME_CONFIG.maze.openness * 0.55) {
        const secondWidth =
          1 + Math.floor(random() * GAME_CONFIG.maze.connectorWidthCells);
        const secondStart =
          openingStart < rect.x + rect.width / 2
            ? rect.x + rect.width - secondWidth - 2
            : rect.x + 2;
        if (!openingsOverlap(secondStart, secondStart + secondWidth, openings)) {
          openings.push([secondStart, secondStart + secondWidth]);
        }
      }
      if (random() < GAME_CONFIG.maze.bonusConnectorChance) {
        const nearStart = random() < 0.5;
        const cornerOffset = 2 + Math.floor(random() * 2);
        const bonusStart = nearStart
          ? rect.x + cornerOffset
          : rect.x + rect.width - cornerOffset - 1;
        if (!openingsOverlap(bonusStart, bonusStart + 1, openings)) {
          openings.push([bonusStart, bonusStart + 1]);
        }
      }
      const alcove = rollAlcove(
        random,
        rect.x,
        rect.x + rect.width,
        openings,
        split,
        rect.height - split,
      );
      addHorizontalPartition(
        features,
        edges,
        safeWidth,
        safeHeight,
        splitZ,
        rect.x,
        rect.x + rect.width,
        openings,
        "wall",
        alcove,
      );
      addDoorBaffles(
        features,
        edges,
        safeWidth,
        safeHeight,
        rect,
        false,
        splitZ,
        openings,
        splitIndex,
        random,
      );
      leaves.push(
        { x: rect.x, z: rect.z, width: rect.width, height: split },
        { x: rect.x, z: splitZ, width: rect.width, height: rect.height - split },
      );
    }
  }

  const zones = leaves.map((rect, id) => ({ id, ...rect }));
  for (const zone of zones) {
    for (let z = zone.z; z < zone.z + zone.height; z += 1) {
      for (let x = zone.x; x < zone.x + zone.width; x += 1) {
        zoneIds[index(safeWidth, x, z)] = zone.id + 1;
      }
    }

    const partitionChance = Math.min(
      0.92,
      GAME_CONFIG.maze.partitionDensity * (0.65 + GAME_CONFIG.maze.occlusion * 0.7),
    );
    const structureBudget = Math.max(
      1,
      Math.min(8, 1 + Math.floor((zone.width * zone.height) / 60)),
    );
    for (let structureIndex = 0; structureIndex < structureBudget; structureIndex += 1) {
      if (random() >= partitionChance) continue;
      const repeatPattern = random() < GAME_CONFIG.maze.repetition;
      const vertical = repeatPattern
        ? (zone.id + structureIndex) % 2 === 0
        : zone.width >= zone.height
          ? random() < 0.7
          : random() < 0.3;
      const kind = repeatPattern
        ? (zone.id + structureIndex) % 4 === 0
          ? "wall"
          : (zone.id + structureIndex) % 3 === 0
            ? "counter"
            : "divider"
        : random() < 0.28
          ? "wall"
          : random() < 0.5
            ? "counter"
            : "divider";
      if (vertical && zone.height >= 8) {
        const x = zone.x + 2 + Math.floor(random() * Math.max(1, zone.width - 4));
        const length = Math.max(3, Math.floor(zone.height * (0.35 + random() * 0.25)));
        const start =
          zone.z + 2 + Math.floor(random() * Math.max(1, zone.height - length - 4));
        addVerticalPartition(
          features,
          edges,
          safeWidth,
          safeHeight,
          x,
          start,
          start + length,
          [],
          kind,
        );
      } else if (zone.width >= 8) {
        const z = zone.z + 2 + Math.floor(random() * Math.max(1, zone.height - 4));
        const length = Math.max(3, Math.floor(zone.width * (0.35 + random() * 0.25)));
        const start =
          zone.x + 2 + Math.floor(random() * Math.max(1, zone.width - length - 4));
        addHorizontalPartition(
          features,
          edges,
          safeWidth,
          safeHeight,
          z,
          start,
          start + length,
          [],
          kind,
        );
      }
    }

    const stubBudget = Math.min(4, 1 + Math.floor((zone.width * zone.height) / 120));
    for (let stubIndex = 0; stubIndex < stubBudget; stubIndex += 1) {
      if (random() >= GAME_CONFIG.maze.stubWallDensity) continue;
      const edge = Math.floor(random() * 4);
      if (edge === 0 || edge === 2) {
        const x =
          zone.x + 2 + Math.floor(random() * Math.max(1, zone.width - 4));
        const lengthRoll = 0.25 + random() * 0.2;
        const kind = random() < 0.6 ? "wall" : "divider";
        const length = Math.min(
          zone.height - 3,
          Math.max(2, Math.floor(zone.height * lengthRoll)),
        );
        const start = edge === 0 ? zone.z : zone.z + zone.height - length;
        addVerticalPartition(
          features,
          edges,
          safeWidth,
          safeHeight,
          x,
          start,
          start + length,
          [],
          kind,
        );
      } else {
        const z =
          zone.z + 2 + Math.floor(random() * Math.max(1, zone.height - 4));
        const lengthRoll = 0.25 + random() * 0.2;
        const kind = random() < 0.6 ? "wall" : "divider";
        const length = Math.min(
          zone.width - 3,
          Math.max(2, Math.floor(zone.width * lengthRoll)),
        );
        const start = edge === 3 ? zone.x : zone.x + zone.width - length;
        addHorizontalPartition(
          features,
          edges,
          safeWidth,
          safeHeight,
          z,
          start,
          start + length,
          [],
          kind,
        );
      }
    }

    const placePillar = (x: number, z: number): boolean => {
      if (
        x <= zone.x + 1 ||
        x >= zone.x + zone.width - 2 ||
        z <= zone.z + 1 ||
        z >= zone.z + zone.height - 2 ||
        !cells[index(safeWidth, x, z)]
      ) {
        return false;
      }
      cells[index(safeWidth, x, z)] = 0;
      let pillarWidth = 0.55 + random() * 0.4;
      let pillarDepth = pillarWidth;
      if (random() < 0.2) {
        pillarWidth = 0.5 + random() * 0.3;
        pillarDepth = 0.9 + random() * 0.5;
        if (random() < 0.5) [pillarWidth, pillarDepth] = [pillarDepth, pillarWidth];
      }
      features.push({
        kind: "pillar",
        x: x + 0.5,
        z: z + 0.5,
        width: pillarWidth,
        depth: pillarDepth,
        height: GAME_CONFIG.maze.wallHeight,
        blocksSight: true,
      });
      return true;
    };
    const area = zone.width * zone.height;
    const seedBudget = Math.max(
      area >= 48 ? 1 : 0,
      Math.floor((area * GAME_CONFIG.maze.pillarDensity) / 55),
    );
    const clusterOffsets = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [2, 0],
      [0, 2],
    ] as const;
    for (let seedIndex = 0; seedIndex < seedBudget; seedIndex += 1) {
      const x =
        zone.x + 2 + Math.floor(random() * Math.max(1, zone.width - 4));
      const z =
        zone.z + 2 + Math.floor(random() * Math.max(1, zone.height - 4));
      if (!placePillar(x, z)) continue;
      if (random() >= GAME_CONFIG.maze.pillarClusterChance) continue;
      const additionalPillars = 1 + Math.floor(random() * 3);
      for (let clusterIndex = 0; clusterIndex < additionalPillars; clusterIndex += 1) {
        const [offsetX, offsetZ] =
          clusterOffsets[Math.floor(random() * clusterOffsets.length)];
        placePillar(x + offsetX, z + offsetZ);
      }
    }
  }

  repairConnectivity(cells, edges, features, safeWidth, safeHeight);
  const featureGrid = buildFeatureGrid(features, safeWidth, safeHeight);
  const provisional: Maze = {
    descriptor: {
      generatorVersion: "office-v2",
      seed,
      width: safeWidth,
      height: safeHeight,
      cellSize: GAME_CONFIG.maze.cellSize,
      zoneCount: zones.length,
      hash: "",
    },
    cells,
    edges,
    zoneIds,
    zones,
    features,
    featureGrid,
    spawnCells: [],
    enemySpawnCell: { x: 1, z: 1 },
  };
  const spawns = chooseSpawns(provisional, random);
  provisional.spawnCells = spawns.players;
  provisional.enemySpawnCell = spawns.enemy;
  provisional.descriptor.hash = hashMap(
    cells,
    edges,
    zoneIds,
    features,
    spawns.players,
    spawns.enemy,
  );
  return provisional;
}

export function isOpen(maze: Maze, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= maze.descriptor.width || z >= maze.descriptor.height) return false;
  return maze.cells[index(maze.descriptor.width, x, z)] === 1;
}

export function canTraverse(
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
      ? Edge.East
      : dx === -1 && dz === 0
        ? Edge.West
        : dx === 0 && dz === 1
          ? Edge.South
          : dx === 0 && dz === -1
            ? Edge.North
            : 0;
  return edge !== 0 && (maze.edges[index(maze.descriptor.width, fromX, fromZ)] & edge) === 0;
}

export function cellToWorld(maze: Maze, cell: Vec2): Vec2 {
  const { cellSize, width, height } = maze.descriptor;
  return {
    x: (cell.x - width / 2 + 0.5) * cellSize,
    z: (cell.z - height / 2 + 0.5) * cellSize,
  };
}

export function gridToWorld(maze: Maze, point: Vec2): Vec2 {
  const { cellSize, width, height } = maze.descriptor;
  return {
    x: (point.x - width / 2) * cellSize,
    z: (point.z - height / 2) * cellSize,
  };
}

export function worldToCell(maze: Maze, point: Vec2): Vec2 {
  const { cellSize, width, height } = maze.descriptor;
  return {
    x: Math.floor(point.x / cellSize + width / 2),
    z: Math.floor(point.z / cellSize + height / 2),
  };
}
