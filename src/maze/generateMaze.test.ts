import { describe, expect, it } from "vitest";
import { generateMaze, isOpen } from "./generateMaze";

describe("generateMaze", () => {
  it("is deterministic for a seed", () => {
    const first = generateMaze(12345);
    const second = generateMaze(12345);
    expect(first.descriptor.hash).toBe(second.descriptor.hash);
    expect(first.cells).toEqual(second.cells);
  });

  it("creates connected open cells and enough safe spawns", () => {
    const maze = generateMaze(42);
    const visited = new Set<string>();
    const queue = [maze.spawnCells[0]];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const cell = queue[cursor];
      const key = `${cell.x},${cell.z}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: cell.x + dx, z: cell.z + dz };
        if (isOpen(maze, next.x, next.z) && !visited.has(`${next.x},${next.z}`)) queue.push(next);
      }
    }
    expect(maze.spawnCells.length).toBe(6);
    expect(visited.size).toBe([...maze.cells].filter(Boolean).length);
  });
});
