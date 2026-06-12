import type { Maze } from "../maze/generateMaze";
import { canTraverse } from "../maze/generateMaze";
import type { Vec2 } from "../shared/types";

const STEPS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
] as const;

export interface PathOptions {
  /**
   * How much per-cell cost noise to mix in. 0 yields the shortest route;
   * higher values make the hunter favour side openings, shallow bends and
   * neighbouring rooms over the obvious straight corridor.
   */
  wander: number;
  /** Reseeds the noise so consecutive repaths pick different detours. */
  salt: number;
}

function cellNoise(key: number, salt: number): number {
  let hash = Math.imul(key ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/**
 * Weighted A* over the office grid. Movement cost is 1 plus seeded noise,
 * so with wander > 0 the route deviates organically while staying near
 * optimal. Returns the cell chain including start and goal, or [start]
 * when the goal is unreachable.
 */
export function findPathCells(maze: Maze, start: Vec2, goal: Vec2, options: PathOptions): Vec2[] {
  const { width, height } = maze.descriptor;
  const cellCount = width * height;
  const startKey = start.z * width + start.x;
  const goalKey = goal.z * width + goal.x;
  if (startKey === goalKey) return [start];

  const cost = new Float64Array(cellCount).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(cellCount).fill(-1);
  const heapKeys: number[] = [];
  const heapScores: number[] = [];

  const push = (key: number, score: number) => {
    let child = heapKeys.length;
    heapKeys.push(key);
    heapScores.push(score);
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (heapScores[parent] <= heapScores[child]) break;
      [heapScores[parent], heapScores[child]] = [heapScores[child], heapScores[parent]];
      [heapKeys[parent], heapKeys[child]] = [heapKeys[child], heapKeys[parent]];
      child = parent;
    }
  };

  const pop = (): number => {
    const top = heapKeys[0];
    const lastKey = heapKeys.pop()!;
    const lastScore = heapScores.pop()!;
    if (heapKeys.length > 0) {
      heapKeys[0] = lastKey;
      heapScores[0] = lastScore;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < heapKeys.length && heapScores[left] < heapScores[smallest]) smallest = left;
        if (right < heapKeys.length && heapScores[right] < heapScores[smallest]) smallest = right;
        if (smallest === parent) break;
        [heapScores[parent], heapScores[smallest]] = [heapScores[smallest], heapScores[parent]];
        [heapKeys[parent], heapKeys[smallest]] = [heapKeys[smallest], heapKeys[parent]];
        parent = smallest;
      }
    }
    return top;
  };

  const heuristic = (key: number) =>
    Math.abs((key % width) - goal.x) + Math.abs(Math.floor(key / width) - goal.z);

  cost[startKey] = 0;
  previous[startKey] = startKey;
  push(startKey, heuristic(startKey));

  while (heapKeys.length > 0) {
    const currentKey = pop();
    if (currentKey === goalKey) break;
    const x = currentKey % width;
    const z = Math.floor(currentKey / width);
    for (const step of STEPS) {
      const nextX = x + step.x;
      const nextZ = z + step.z;
      if (
        nextX < 0 ||
        nextZ < 0 ||
        nextX >= width ||
        nextZ >= height ||
        !canTraverse(maze, x, z, nextX, nextZ)
      ) {
        continue;
      }
      const nextKey = nextZ * width + nextX;
      const stepCost = 1 + cellNoise(nextKey, options.salt) * options.wander;
      const nextCost = cost[currentKey] + stepCost;
      if (nextCost >= cost[nextKey]) continue;
      cost[nextKey] = nextCost;
      previous[nextKey] = currentKey;
      push(nextKey, nextCost + heuristic(nextKey));
    }
  }

  if (previous[goalKey] === -1) return [start];
  const reversed: Vec2[] = [];
  let currentKey = goalKey;
  while (currentKey !== startKey) {
    reversed.push({ x: currentKey % width, z: Math.floor(currentKey / width) });
    currentKey = previous[currentKey];
  }
  reversed.push(start);
  return reversed.reverse();
}
