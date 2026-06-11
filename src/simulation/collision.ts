import type { Maze } from "../maze/generateMaze";
import { isOpen, worldToCell } from "../maze/generateMaze";
import type { Vec2 } from "../shared/types";

export function canOccupy(maze: Maze, position: Vec2, radius: number): boolean {
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

export function moveWithCollision(
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
