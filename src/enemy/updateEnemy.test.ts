import { describe, expect, it } from "vitest";
import { generateMaze, gridToWorld } from "../maze/generateMaze";
import { DIFFICULTY_PROFILES } from "../shared/config";
import type { EnemyState, PlayerState } from "../shared/types";
import { createEnemyBrain } from "./brain";
import { hasLineOfSight, updateEnemy } from "./updateEnemy";

function player(position: { x: number; z: number }): PlayerState {
  return {
    id: "player",
    name: "Player",
    position,
    yaw: 0,
    life: "alive",
    isHost: true,
    stompHeld: false,
  };
}

function enemy(position: { x: number; z: number }): EnemyState {
  return {
    id: "enemy-1",
    position,
    yaw: 0,
    scale: 1,
    mode: "roam",
    targetId: null,
    lastSeenPosition: null,
    memoryRemaining: 0,
  };
}

describe("office enemy perception", () => {
  it("blocks sight across a full-height office partition", () => {
    const maze = generateMaze(91);
    const wall = maze.features.find(
      (feature) => feature.kind === "wall" && feature.width > 5,
    )!;
    const center = gridToWorld(maze, { x: wall.x, z: wall.z });
    const horizontal = wall.width > wall.depth;
    const from = horizontal
      ? { x: center.x, z: center.z - 4 }
      : { x: center.x - 4, z: center.z };
    const to = horizontal
      ? { x: center.x, z: center.z + 4 }
      : { x: center.x + 4, z: center.z };
    expect(hasLineOfSight(maze, from, to)).toBe(false);
  });

  it("pursues a visible player and investigates after memory expires", () => {
    const maze = generateMaze(52);
    const brain = createEnemyBrain(52);
    const spawn = maze.spawnCells[0];
    const position = gridToWorld(maze, { x: spawn.x + 0.5, z: spawn.z + 0.5 });
    const initial = updateEnemy(maze, enemy(position), [player({ x: position.x + 2, z: position.z })], 0.05, brain);
    expect(["chase", "attack"]).toContain(initial.enemy.mode);
    expect(initial.enemy.targetId).toBe("player");
    expect(initial.enemy.memoryRemaining).toBe(4);

    const hiddenEnemy = {
      ...initial.enemy,
      position: gridToWorld(maze, { x: 1.5, z: 1.5 }),
      lastSeenPosition: { ...position },
      memoryRemaining: 0.01,
    };
    const expired = updateEnemy(
      maze,
      hiddenEnemy,
      [player(gridToWorld(maze, maze.spawnCells[5]))],
      0.05,
      brain,
    );
    expect(expired.enemy.mode).toBe("investigate");
    expect(expired.enemy.targetId).toBeNull();
    expect(expired.enemy.lastSeenPosition).toEqual({ ...position });
  });

  it("commits to pursuit longer on higher difficulties without changing core states", () => {
    const maze = generateMaze(52);
    const spawn = maze.spawnCells[0];
    const position = gridToWorld(maze, { x: spawn.x + 0.5, z: spawn.z + 0.5 });
    const target = player({ x: position.x + 2, z: position.z });
    const easy = updateEnemy(
      maze,
      enemy(position),
      [target],
      0.05,
      createEnemyBrain(52),
      DIFFICULTY_PROFILES.easy,
    );
    const hard = updateEnemy(
      maze,
      enemy(position),
      [target],
      0.05,
      createEnemyBrain(52),
      DIFFICULTY_PROFILES.hard,
    );

    expect(hard.enemy.mode).toBe(easy.enemy.mode);
    expect(hard.enemy.memoryRemaining).toBeGreaterThan(easy.enemy.memoryRemaining);
  });

  it("sweeps nearby spaces after investigating, then returns to roaming", () => {
    const maze = generateMaze(52);
    const brain = createEnemyBrain(7);
    const spawn = maze.spawnCells[0];
    const position = gridToWorld(maze, { x: spawn.x + 0.5, z: spawn.z + 0.5 });
    const farPlayer = player(gridToWorld(maze, maze.spawnCells[5]));

    // Arrived at the last known position with no target in sight.
    brain.state = "investigate";
    let state = enemy(position);
    state = { ...state, lastSeenPosition: { ...position }, memoryRemaining: 0 };
    const sweeping = updateEnemy(maze, state, [farPlayer], 0.05, brain);
    expect(sweeping.enemy.mode).toBe("search");
    expect(brain.searchQueue.length).toBeGreaterThan(0);

    // Drain the search budget and confirm it goes back to broad roaming.
    let current = sweeping.enemy;
    for (let tick = 0; tick < 20 * 12 && current.mode !== "roam"; tick += 1) {
      current = updateEnemy(maze, current, [farPlayer], 0.05, brain).enemy;
    }
    expect(current.mode).toBe("roam");
    expect(current.lastSeenPosition).toBeNull();
    expect(current.targetId).toBeNull();
  });

  it("roams toward fresh zones instead of standing idle", () => {
    const maze = generateMaze(91);
    const brain = createEnemyBrain(91);
    const start = gridToWorld(maze, {
      x: maze.enemySpawnCell.x + 0.5,
      z: maze.enemySpawnCell.z + 0.5,
    });
    const farPlayer = player(gridToWorld(maze, maze.spawnCells[0]));
    let current = enemy(start);
    for (let tick = 0; tick < 20 * 8; tick += 1) {
      current = updateEnemy(maze, current, [farPlayer], 0.05, brain).enemy;
    }
    expect(current.mode).toBe("roam");
    const travelled = Math.hypot(current.position.x - start.x, current.position.z - start.z);
    expect(travelled).toBeGreaterThan(3);
    expect(brain.recentZones.length).toBeGreaterThan(0);
  });

  it("accelerates smoothly instead of snapping to full speed", () => {
    const maze = generateMaze(91);
    const brain = createEnemyBrain(91);
    const start = gridToWorld(maze, {
      x: maze.enemySpawnCell.x + 0.5,
      z: maze.enemySpawnCell.z + 0.5,
    });
    const farPlayer = player(gridToWorld(maze, maze.spawnCells[0]));
    const first = updateEnemy(maze, enemy(start), [farPlayer], 0.05, brain);
    const firstStep = Math.hypot(
      first.enemy.position.x - start.x,
      first.enemy.position.z - start.z,
    );
    // One tick from standstill must be well below a full-speed stride.
    expect(firstStep).toBeLessThan(1.9 * 0.05 * 0.6);
  });
});
