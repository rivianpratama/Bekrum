import { GAME_CONFIG } from "../shared/config";
import type { MazeDescriptor, Vec2 } from "../shared/types";
import { createRandom } from "./random";

export interface Maze {
  descriptor: MazeDescriptor;
  cells: Uint8Array;
  spawnCells: Vec2[];
}

const DIRECTIONS = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
] as const;

function index(width: number, x: number, z: number): number {
  return z * width + x;
}

function hashCells(cells: Uint8Array): string {
  let hash = 2166136261;
  for (const cell of cells) {
    hash ^= cell;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function generateMaze(
  seed: number,
  width: number = GAME_CONFIG.maze.width,
  height: number = GAME_CONFIG.maze.height,
): Maze {
  const safeWidth = Math.max(7, width | 1);
  const safeHeight = Math.max(7, height | 1);
  const random = createRandom(seed);
  const cells = new Uint8Array(safeWidth * safeHeight);
  const stack = [{ x: 1, z: 1 }];
  cells[index(safeWidth, 1, 1)] = 1;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const options = DIRECTIONS
      .map((direction) => ({
        x: current.x + direction.x * 2,
        z: current.z + direction.z * 2,
        wallX: current.x + direction.x,
        wallZ: current.z + direction.z,
      }))
      .filter(
        (candidate) =>
          candidate.x > 0 &&
          candidate.z > 0 &&
          candidate.x < safeWidth - 1 &&
          candidate.z < safeHeight - 1 &&
          cells[index(safeWidth, candidate.x, candidate.z)] === 0,
      );

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const next = options[Math.floor(random() * options.length)];
    cells[index(safeWidth, next.wallX, next.wallZ)] = 1;
    cells[index(safeWidth, next.x, next.z)] = 1;
    stack.push({ x: next.x, z: next.z });
  }

  for (let z = 2; z < safeHeight - 2; z += 2) {
    for (let x = 2; x < safeWidth - 2; x += 2) {
      if (random() > GAME_CONFIG.maze.loopChance) continue;
      const horizontal = random() > 0.5;
      const wallIndex = index(safeWidth, x, z);
      if (
        (horizontal &&
          cells[index(safeWidth, x - 1, z)] &&
          cells[index(safeWidth, x + 1, z)]) ||
        (!horizontal &&
          cells[index(safeWidth, x, z - 1)] &&
          cells[index(safeWidth, x, z + 1)])
      ) {
        cells[wallIndex] = 1;
      }
    }
  }

  const spawnCells: Vec2[] = [];
  for (let radius = 0; radius < 6 && spawnCells.length < GAME_CONFIG.room.maxPlayers; radius += 1) {
    for (let z = 1; z < safeHeight - 1; z += 1) {
      for (let x = 1; x < safeWidth - 1; x += 1) {
        if (Math.abs(x - 1) + Math.abs(z - 1) !== radius) continue;
        if (cells[index(safeWidth, x, z)] === 1) spawnCells.push({ x, z });
      }
    }
  }

  return {
    descriptor: {
      seed,
      width: safeWidth,
      height: safeHeight,
      cellSize: GAME_CONFIG.maze.cellSize,
      hash: hashCells(cells),
    },
    cells,
    spawnCells,
  };
}

export function isOpen(maze: Maze, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= maze.descriptor.width || z >= maze.descriptor.height) return false;
  return maze.cells[index(maze.descriptor.width, x, z)] === 1;
}

export function cellToWorld(maze: Maze, cell: Vec2): Vec2 {
  const { cellSize, width, height } = maze.descriptor;
  return {
    x: (cell.x - width / 2 + 0.5) * cellSize,
    z: (cell.z - height / 2 + 0.5) * cellSize,
  };
}

export function worldToCell(maze: Maze, point: Vec2): Vec2 {
  const { cellSize, width, height } = maze.descriptor;
  return {
    x: Math.floor(point.x / cellSize + width / 2),
    z: Math.floor(point.z / cellSize + height / 2),
  };
}
