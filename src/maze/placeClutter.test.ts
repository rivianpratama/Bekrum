/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLUTTER_ASSET_BY_ID } from "../assets/clutterManifest";
import { GAME_CONFIG } from "../shared/config";
import { featureBounds } from "../simulation/collision";
import { canTraverse, generateMaze, isOpen, type Maze } from "./generateMaze";
import { doorHasFatPath } from "./placeClutter";

function reachableNonPocketCells(maze: Maze): Set<number> {
  const width = maze.descriptor.width;
  const start = maze.spawnCells[0];
  const visited = new Set<number>();
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    const key = cell.z * width + cell.x;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: cell.x + dx, z: cell.z + dz };
      if (
        isOpen(maze, next.x, next.z) &&
        canTraverse(maze, cell.x, cell.z, next.x, next.z)
      ) {
        const nextKey = next.z * width + next.x;
        const zoneId = (maze.zoneIds[nextKey] || 1) - 1;
        if (!maze.sealedPocketZoneIds.includes(zoneId) && !visited.has(nextKey)) {
          queue.push(next);
        }
      }
    }
  }
  return visited;
}

function overlap(
  left: { minX: number; maxX: number; minZ: number; maxZ: number },
  right: { minX: number; maxX: number; minZ: number; maxZ: number },
): number {
  return (
    Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX)) *
    Math.max(0, Math.min(left.maxZ, right.maxZ) - Math.max(left.minZ, right.minZ))
  );
}

describe("clutter-v1 placement", () => {
  it("is deterministic and changes across seeds", () => {
    const first = generateMaze(12345);
    const second = generateMaze(12345);
    const different = generateMaze(12346);
    expect(first.clutter).toEqual(second.clutter);
    expect(first.descriptor.hash).toBe(second.descriptor.hash);
    expect(different.clutter).not.toEqual(first.clutter);
    expect(different.descriptor.hash).not.toBe(first.descriptor.hash);
  }, 10_000);

  it("keeps every non-pocket cell connected and caps sealed pockets", () => {
    for (const seed of [7, 42, 91, 12345, 271959538]) {
      const maze = generateMaze(seed);
      const reachable = reachableNonPocketCells(maze);
      const expected = [...maze.cells].filter((open, index) => {
        if (!open) return false;
        const zoneId = (maze.zoneIds[index] || 1) - 1;
        return !maze.sealedPocketZoneIds.includes(zoneId);
      }).length;
      expect(reachable.size, `seed ${seed}`).toBe(expected);
      expect(maze.sealedPocketZoneIds.length).toBeLessThanOrEqual(
        GAME_CONFIG.clutter.maxSealedPockets,
      );
    }
  }, 10_000);

  it("keeps every non-pocket doorway traversable at enemy radius", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const maze = generateMaze(seed);
      for (const door of maze.doorCells) {
        const index = door.z * maze.descriptor.width + door.x;
        const zoneId = (maze.zoneIds[index] || 1) - 1;
        if (maze.sealedPocketZoneIds.includes(zoneId)) continue;
        expect(
          doorHasFatPath(maze, door, GAME_CONFIG.enemy.radius + 0.05),
          `seed ${seed}, door ${door.x},${door.z}`,
        ).toBe(true);
      }
    }
  }, 15_000);

  it("respects global and per-zone collider budgets", () => {
    for (const seed of [17, 42, 99]) {
      const maze = generateMaze(seed);
      expect(maze.clutter.length).toBeLessThanOrEqual(GAME_CONFIG.clutter.maxInstances);
      for (const zone of maze.zones) {
        const zoneBounds = {
          minX: zone.x,
          maxX: zone.x + zone.width,
          minZ: zone.z,
          maxZ: zone.z + zone.height,
        };
        const colliderArea = maze.features
          .filter((feature) => feature.kind === "clutter")
          .reduce((area, feature) => {
            const bounds = {
              minX: feature.x - feature.width / 2,
              maxX: feature.x + feature.width / 2,
              minZ: feature.z - feature.depth / 2,
              maxZ: feature.z + feature.depth / 2,
            };
            return area + overlap(zoneBounds, bounds);
          }, 0);
        const openArea = [...maze.zoneIds].filter(
          (zoneId, index) => zoneId === zone.id + 1 && maze.cells[index],
        ).length;
        expect(colliderArea, `seed ${seed}, zone ${zone.id}`).toBeLessThanOrEqual(
          openArea * 0.35,
        );
      }
    }
  }, 10_000);

  it("produces empty, sparse, dense, and door-adjacent zone compositions", () => {
    const zoneCounts: number[] = [];
    let pinchedDoors = 0;
    for (const seed of [7, 42, 91]) {
      const maze = generateMaze(seed);
      for (const zone of maze.zones) {
        zoneCounts.push(
          maze.clutter.filter((instance) => {
            const x = Math.floor(instance.x);
            const z = Math.floor(instance.z);
            return maze.zoneIds[z * maze.descriptor.width + x] === zone.id + 1;
          }).length,
        );
      }
      for (const door of maze.doorCells) {
        if (
          maze.features.some(
            (feature) =>
              feature.kind === "clutter" &&
              Math.hypot(feature.x - (door.x + 0.5), feature.z - (door.z + 0.5)) <= 2.5,
          )
        ) {
          pinchedDoors += 1;
        }
      }
    }
    expect(zoneCounts.some((count) => count === 0)).toBe(true);
    expect(zoneCounts.some((count) => count >= 1 && count <= 3)).toBe(true);
    expect(zoneCounts.some((count) => count >= 5)).toBe(true);
    expect(pinchedDoors).toBeGreaterThan(10);
  }, 10_000);

  it("stores clutter feature width and depth in cell units", () => {
    const maze = generateMaze(42);
    const instance = maze.clutter.find((candidate) => {
      const asset = CLUTTER_ASSET_BY_ID.get(candidate.assetId);
      if (!asset || candidate.featureIndex < 0 || candidate.tiltAngle > Math.PI / 3) {
        return false;
      }
      const feature = maze.features[candidate.featureIndex];
      const cosine = Math.abs(Math.cos(candidate.yaw));
      const sine = Math.abs(Math.sin(candidate.yaw));
      const expectedWidth =
        (asset.footprint.width * cosine + asset.footprint.depth * sine) *
        candidate.scale *
        GAME_CONFIG.clutter.colliderShrink;
      return Math.abs(feature.width * maze.descriptor.cellSize - expectedWidth) < 0.001;
    });
    expect(instance).toBeDefined();
    const asset = CLUTTER_ASSET_BY_ID.get(instance!.assetId)!;
    const feature = maze.features[instance!.featureIndex];
    const bounds = featureBounds(maze, feature);
    const cosine = Math.abs(Math.cos(instance!.yaw));
    const sine = Math.abs(Math.sin(instance!.yaw));
    const expectedWidth =
      (asset.footprint.width * cosine + asset.footprint.depth * sine) *
      instance!.scale *
      GAME_CONFIG.clutter.colliderShrink;
    const expectedDepth =
      (asset.footprint.width * sine + asset.footprint.depth * cosine) *
      instance!.scale *
      GAME_CONFIG.clutter.colliderShrink;
    expect(bounds.maxX - bounds.minX).toBeCloseTo(expectedWidth, 5);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(expectedDepth, 5);
  });

  it("keeps placement free of rendering imports", () => {
    const source = readFileSync(resolve(process.cwd(), "src/maze/placeClutter.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["']three["']/);
    expect(source).not.toMatch(/@mkkellogg\/gaussian-splats-3d/);
  });
});
