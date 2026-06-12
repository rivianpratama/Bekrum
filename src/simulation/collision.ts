import type { Maze, OfficeFeature } from "../maze/generateMaze";
import { isOpen, worldToCell } from "../maze/generateMaze";
import type { Vec2 } from "../shared/types";

function featureBounds(maze: Maze, feature: OfficeFeature) {
  const { cellSize, width, height } = maze.descriptor;
  const centerX = (feature.x - width / 2) * cellSize;
  const centerZ = (feature.z - height / 2) * cellSize;
  return {
    minX: centerX - (feature.width * cellSize) / 2,
    maxX: centerX + (feature.width * cellSize) / 2,
    minZ: centerZ - (feature.depth * cellSize) / 2,
    maxZ: centerZ + (feature.depth * cellSize) / 2,
  };
}

function clearsOpenCells(maze: Maze, position: Vec2, radius: number): boolean {
  const checks = [
    { x: position.x - radius, z: position.z - radius },
    { x: position.x + radius, z: position.z - radius },
    { x: position.x - radius, z: position.z + radius },
    { x: position.x + radius, z: position.z + radius },
  ];
  return checks.every((point) => {
    const cell = worldToCell(maze, point);
    return isOpen(maze, cell.x, cell.z);
  });
}

function clearsFeatures(
  maze: Maze,
  position: Vec2,
  radius: number,
  features: Iterable<OfficeFeature>,
): boolean {
  for (const feature of features) {
    const bounds = featureBounds(maze, feature);
    const nearestX = Math.max(bounds.minX, Math.min(position.x, bounds.maxX));
    const nearestZ = Math.max(bounds.minZ, Math.min(position.z, bounds.maxZ));
    if (Math.hypot(position.x - nearestX, position.z - nearestZ) < radius) return false;
  }
  return true;
}

export function canOccupyBruteForce(maze: Maze, position: Vec2, radius: number): boolean {
  return (
    clearsOpenCells(maze, position, radius) &&
    clearsFeatures(maze, position, radius, maze.features)
  );
}

export function canOccupy(maze: Maze, position: Vec2, radius: number): boolean {
  if (!clearsOpenCells(maze, position, radius)) return false;
  const cell = worldToCell(maze, position);
  const nearby = new Set<OfficeFeature>();
  for (let z = cell.z - 1; z <= cell.z + 1; z += 1) {
    if (z < 0 || z >= maze.descriptor.height) continue;
    for (let x = cell.x - 1; x <= cell.x + 1; x += 1) {
      if (x < 0 || x >= maze.descriptor.width) continue;
      for (const feature of maze.featureGrid.get(z * maze.descriptor.width + x) ?? []) {
        nearby.add(feature);
      }
    }
  }
  return clearsFeatures(maze, position, radius, nearby);
}

function moveAxis(
  maze: Maze,
  current: Vec2,
  delta: Vec2,
  radius: number,
): Vec2 {
  const nextX = { x: current.x + delta.x, z: current.z };
  const x = canOccupy(maze, nextX, radius) ? nextX.x : current.x;
  const nextZ = { x, z: current.z + delta.z };
  return canOccupy(maze, nextZ, radius) ? nextZ : { x, z: current.z };
}

export function moveWithCollision(
  maze: Maze,
  current: Vec2,
  delta: Vec2,
  radius: number,
): Vec2 {
  const distance = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.15, radius * 0.5)));
  const step = { x: delta.x / steps, z: delta.z / steps };
  let position = current;
  for (let index = 0; index < steps; index += 1) {
    position = moveAxis(maze, position, step, radius);
  }
  return position;
}
