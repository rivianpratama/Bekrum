import { cellToWorld, worldToCell, type Maze } from "../maze/generateMaze";
import { GAME_CONFIG } from "../shared/config";
import type { EnemyState, PlayerState } from "../shared/types";
import { distance, enemyScaleForProximity, teamProximityFactor } from "../simulation/rules";
import { nextPathCell } from "./pathfinding";

export interface EnemyUpdate {
  enemy: EnemyState;
  proximityFactor: number;
  contactedPlayerId: string | null;
}

export function updateEnemy(
  maze: Maze,
  enemy: EnemyState,
  players: PlayerState[],
  dt: number,
): EnemyUpdate {
  const living = players.filter((player) => player.life === "alive");
  const proximityFactor = teamProximityFactor(players);
  const scale = enemyScaleForProximity(proximityFactor);
  if (living.length === 0 || enemy.mode === "stomped") {
    return { enemy: { ...enemy, scale }, proximityFactor, contactedPlayerId: null };
  }

  let target = living[0];
  let targetScore = Number.POSITIVE_INFINITY;
  for (const player of living) {
    const nearestAlly = living.reduce<number>((nearest, ally) => {
      if (ally.id === player.id) return nearest;
      return Math.min(nearest, distance(player.position, ally.position));
    }, GAME_CONFIG.enemy.fullStrengthDistance);
    const score = distance(enemy.position, player.position) - nearestAlly * 0.25;
    if (score < targetScore) {
      target = player;
      targetScore = score;
    }
  }

  const targetDistance = distance(enemy.position, target.position);
  const mode = targetDistance <= GAME_CONFIG.enemy.detectionRange ? "chase" : "search";
  const startCell = worldToCell(maze, enemy.position);
  const goalCell = worldToCell(maze, target.position);
  const pathCell = nextPathCell(maze, startCell, goalCell);
  const waypoint = cellToWorld(maze, pathCell);
  const dx = waypoint.x - enemy.position.x;
  const dz = waypoint.z - enemy.position.z;
  const length = Math.hypot(dx, dz) || 1;
  const baseSpeed = mode === "chase" ? GAME_CONFIG.enemy.chaseSpeed : GAME_CONFIG.enemy.searchSpeed;
  const speed = baseSpeed * (0.55 + scale * 0.45);
  const step = Math.min(length, speed * dt);
  const position = {
    x: enemy.position.x + (dx / length) * step,
    z: enemy.position.z + (dz / length) * step,
  };
  const contactRange = GAME_CONFIG.enemy.contactRange * Math.max(0.55, scale);
  const contactedPlayer = living.find((player) => distance(position, player.position) <= contactRange);

  return {
    enemy: {
      position,
      yaw: Math.atan2(dx, dz),
      scale,
      mode,
      targetId: target.id,
    },
    proximityFactor,
    contactedPlayerId: contactedPlayer?.id ?? null,
  };
}
