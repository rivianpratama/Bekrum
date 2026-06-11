import { GAME_CONFIG } from "../shared/config";
import type { EnemyState, PlayerState, Vec2 } from "../shared/types";

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function teamProximityFactor(players: PlayerState[]): number {
  const living = players.filter((player) => player.life === "alive");
  if (living.length < 2) return 0;

  let maxDistance = 0;
  for (let i = 0; i < living.length; i += 1) {
    for (let j = i + 1; j < living.length; j += 1) {
      maxDistance = Math.max(maxDistance, distance(living[i].position, living[j].position));
    }
  }

  const { groupedDistance, fullStrengthDistance } = GAME_CONFIG.enemy;
  return Math.max(
    0,
    Math.min(1, 1 - (maxDistance - groupedDistance) / (fullStrengthDistance - groupedDistance)),
  );
}

export function enemyScaleForProximity(factor: number): number {
  return 1 - Math.max(0, Math.min(1, factor)) * (1 - GAME_CONFIG.enemy.minScale);
}

export function isStompReady(
  players: PlayerState[],
  enemy: EnemyState,
  proximityFactor: number,
): boolean {
  const living = players.filter((player) => player.life === "alive");
  return (
    living.length >= GAME_CONFIG.room.minPlayers &&
    proximityFactor >= GAME_CONFIG.stomp.proximityFactor &&
    enemy.scale <= GAME_CONFIG.stomp.maxEnemyScale &&
    living.every((player) => distance(player.position, enemy.position) <= GAME_CONFIG.stomp.range)
  );
}
