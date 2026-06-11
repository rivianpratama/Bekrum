import type { Maze } from "../maze/generateMaze";
import { isOpen } from "../maze/generateMaze";
import type { Vec2 } from "../shared/types";

const STEPS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

export function nextPathCell(maze: Maze, start: Vec2, goal: Vec2): Vec2 {
  const key = (point: Vec2) => `${point.x},${point.z}`;
  const queue = [start];
  const previous = new Map<string, Vec2 | null>([[key(start), null]]);
  let found = false;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.x === goal.x && current.z === goal.z) {
      found = true;
      break;
    }
    for (const step of STEPS) {
      const next = { x: current.x + step.x, z: current.z + step.z };
      if (!isOpen(maze, next.x, next.z) || previous.has(key(next))) continue;
      previous.set(key(next), current);
      queue.push(next);
    }
  }

  if (!found) return start;
  let current = goal;
  let parent = previous.get(key(current));
  while (parent && !(parent.x === start.x && parent.z === start.z)) {
    current = parent;
    parent = previous.get(key(current));
  }
  return current;
}
