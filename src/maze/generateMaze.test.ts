import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../shared/config";
import { canOccupy, canOccupyBruteForce } from "../simulation/collision";
import { createRandom } from "./random";
import {
  canTraverse,
  chooseEnemySpawn,
  generateMaze,
  isOpen,
  navigationDistance,
} from "./generateMaze";

function reachableCells(seed: number, dimension?: number) {
  const maze = generateMaze(seed, dimension, dimension);
  const visited = new Set<string>();
  const queue = [maze.spawnCells[0]];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    const key = `${cell.x},${cell.z}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: cell.x + dx, z: cell.z + dz };
      if (
        isOpen(maze, next.x, next.z) &&
        canTraverse(maze, cell.x, cell.z, next.x, next.z) &&
        !visited.has(`${next.x},${next.z}`)
      ) {
        queue.push(next);
      }
    }
  }
  return { maze, visited };
}

describe("office floor generation", () => {
  it("is deterministic for a seed", () => {
    const first = generateMaze(12345);
    const second = generateMaze(12345);
    expect(first.descriptor).toEqual(second.descriptor);
    expect(first.cells).toEqual(second.cells);
    expect(first.edges).toEqual(second.edges);
    expect(first.zoneIds).toEqual(second.zoneIds);
    expect(first.features).toEqual(second.features);
    expect(first.spawnCells).toEqual(second.spawnCells);
    expect(first.enemySpawnCell).toEqual(second.enemySpawnCell);
    expect(generateMaze(12346).descriptor.hash).not.toBe(first.descriptor.hash);
  });

  it("creates one connected 300 meter office floor with separated spawns", () => {
    const { maze, visited } = reachableCells(42);
    const openCount = [...maze.cells].filter(Boolean).length;
    expect(maze.descriptor.generatorVersion).toBe("office-v2");
    expect(maze.descriptor.width).toBe(151);
    expect(maze.descriptor.height).toBe(151);
    expect(maze.zones.length).toBeGreaterThanOrEqual(45);
    expect(maze.zones.length).toBeLessThanOrEqual(60);
    expect(visited.size).toBe(openCount);
    expect(maze.spawnCells).toHaveLength(6);

    const minimumDistanceCells =
      GAME_CONFIG.maze.spawnSeparationMeters / maze.descriptor.cellSize;
    for (let first = 0; first < maze.spawnCells.length; first += 1) {
      for (let second = first + 1; second < maze.spawnCells.length; second += 1) {
        const a = maze.spawnCells[first];
        const b = maze.spawnCells[second];
        expect(navigationDistance(maze, a, b)).toBeGreaterThanOrEqual(minimumDistanceCells);
        expect(maze.zoneIds[a.z * maze.descriptor.width + a.x]).not.toBe(
          maze.zoneIds[b.z * maze.descriptor.width + b.x],
        );
      }
    }
  });

  it("keeps representative generated floors connected", () => {
    for (const seed of [7, 42, 91, 12345, 271959538]) {
      const { maze, visited } = reachableCells(seed);
      expect(visited.size, `seed ${seed}`).toBe([...maze.cells].filter(Boolean).length);
    }
  });

  it("generates connected small, medium, and large maps", () => {
    for (const dimension of [71, 111, 151]) {
      const { maze, visited } = reachableCells(4242, dimension);
      expect(maze.descriptor.width).toBe(dimension);
      expect(maze.descriptor.height).toBe(dimension);
      expect(visited.size, `${dimension}x${dimension}`).toBe(
        [...maze.cells].filter(Boolean).length,
      );
      expect(new Set(maze.spawnCells.map((cell) => `${cell.x},${cell.z}`)).size).toBe(6);
    }
  });

  it("places the enemy far from the players actually present", () => {
    const maze = generateMaze(271959538);
    const enemy = chooseEnemySpawn(maze, [maze.spawnCells[0]]);
    expect(navigationDistance(maze, maze.spawnCells[0], enemy)).toBeGreaterThan(80);
  });

  it("uses office architecture rather than blocked-cell corridors", () => {
    const maze = generateMaze(7);
    const openRatio = [...maze.cells].filter(Boolean).length / maze.cells.length;
    const fullHeight = maze.features.filter((feature) => feature.kind === "wall").length;
    const pillars = maze.features.filter((feature) => feature.kind === "pillar").length;
    const secondary = maze.features.filter((feature) =>
      ["divider", "counter", "pillar"].includes(feature.kind),
    ).length;
    const broadZones = maze.zones.filter(
      (zone) => zone.width >= 9 && zone.height >= 9,
    ).length;
    expect(openRatio).toBeGreaterThan(0.84);
    expect(fullHeight).toBeGreaterThan(180);
    expect(pillars).toBeGreaterThan(140);
    expect(secondary).toBeGreaterThan(220);
    expect(broadZones / maze.zones.length).toBeGreaterThan(0.65);
    expect(
      maze.features.every((feature) =>
        ["wall", "divider", "counter", "pillar"].includes(feature.kind),
      ),
    ).toBe(true);
  });

  it("puts a full-height occluder in every zone", () => {
    const maze = generateMaze(91);
    for (const zone of maze.zones) {
      expect(
        maze.features.some(
          (feature) =>
            feature.height === GAME_CONFIG.maze.wallHeight &&
            feature.blocksSight &&
            feature.x >= zone.x &&
            feature.x <= zone.x + zone.width &&
            feature.z >= zone.z &&
            feature.z <= zone.z + zone.height,
        ),
        `zone ${zone.id}`,
      ).toBe(true);
    }
  });

  it("matches brute-force feature collision for seeded positions", () => {
    const maze = generateMaze(12345);
    const random = createRandom(908172);
    const worldWidth = maze.descriptor.width * maze.descriptor.cellSize;
    const worldHeight = maze.descriptor.height * maze.descriptor.cellSize;
    for (let sample = 0; sample < 500; sample += 1) {
      const position = {
        x: (random() - 0.5) * worldWidth,
        z: (random() - 0.5) * worldHeight,
      };
      expect(canOccupy(maze, position, GAME_CONFIG.player.radius)).toBe(
        canOccupyBruteForce(maze, position, GAME_CONFIG.player.radius),
      );
    }
  });

  it("caps the 95th percentile straight sightline near 16 cells", () => {
    const maze = generateMaze(271959538);
    const random = createRandom(349817);
    const openCells: Array<{ x: number; z: number }> = [];
    for (let z = 1; z < maze.descriptor.height - 1; z += 1) {
      for (let x = 1; x < maze.descriptor.width - 1; x += 1) {
        if (isOpen(maze, x, z)) openCells.push({ x, z });
      }
    }
    const runs: number[] = [];
    for (let sample = 0; sample < 200; sample += 1) {
      const start = openCells[Math.floor(random() * openCells.length)];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        let x = start.x;
        let z = start.z;
        let run = 0;
        while (canTraverse(maze, x, z, x + dx, z + dz)) {
          x += dx;
          z += dz;
          run += 1;
        }
        runs.push(run);
      }
    }
    runs.sort((left, right) => left - right);
    expect(runs[Math.floor(runs.length * 0.95)]).toBeLessThanOrEqual(17);
  });
});
