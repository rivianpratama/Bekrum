import { cellToWorld, isOpen, worldToCell, type Maze, type OfficeZone } from "../maze/generateMaze";
import {
  DIFFICULTY_PROFILES,
  GAME_CONFIG,
  type DifficultyProfile,
} from "../shared/config";
import type { EnemyState, PlayerState, Vec2 } from "../shared/types";
import { moveWithCollision } from "../simulation/collision";
import { distance, enemyScaleForProximity, teamProximityFactor } from "../simulation/rules";
import type { EnemyBrain, HunterState } from "./brain";
import { findPathCells } from "./pathfinding";

export interface EnemyUpdate {
  enemy: EnemyState;
  proximityFactor: number;
  contactedPlayerId: string | null;
}

const ENEMY = GAME_CONFIG.enemy;
const WAYPOINT_REACH = 0.85;
const GOAL_REACH = 1.25;

/** Route noise per state: pursuit is direct, prowling cuts through side spaces. */
const PATH_WANDER: Record<HunterState, number> = {
  attack: 0,
  chase: 0.2,
  investigate: 0.5,
  search: 0.9,
  roam: 1.2,
};

/** Direction commitment: minimum seconds between repaths per state. */
const PATH_COMMIT: Record<HunterState, number> = {
  attack: 0.3,
  chase: 0.45,
  investigate: 1.2,
  search: 1.5,
  roam: 2.5,
};

/** Subtle heading wander amplitude (radians) per state. */
const WANDER_AMPLITUDE: Record<HunterState, number> = {
  attack: 0,
  chase: 0.06,
  investigate: 0.12,
  search: 0.2,
  roam: 0.26,
};

const BASE_SPEED: Record<HunterState, number> = {
  attack: ENEMY.chaseSpeed,
  chase: ENEMY.chaseSpeed,
  investigate: ENEMY.investigateSpeed,
  search: ENEMY.searchSpeed,
  roam: ENEMY.roamSpeed,
};

function segmentIntersectsBounds(
  start: { x: number; z: number },
  end: { x: number; z: number },
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  let minimum = 0;
  let maximum = 1;
  for (const [origin, delta, lower, upper] of [
    [start.x, dx, minX, maxX],
    [start.z, dz, minZ, maxZ],
  ] as const) {
    if (Math.abs(delta) < 0.0001) {
      if (origin < lower || origin > upper) return false;
      continue;
    }
    const first = (lower - origin) / delta;
    const second = (upper - origin) / delta;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return false;
  }
  return true;
}

export function hasLineOfSight(maze: Maze, from: PlayerState["position"], to: PlayerState["position"]): boolean {
  const { cellSize, width, height } = maze.descriptor;
  for (const feature of maze.features) {
    if (!feature.blocksSight && feature.height < 1.35) continue;
    const centerX = (feature.x - width / 2) * cellSize;
    const centerZ = (feature.z - height / 2) * cellSize;
    const halfWidth = (feature.width * cellSize) / 2;
    const halfDepth = (feature.depth * cellSize) / 2;
    if (
      segmentIntersectsBounds(
        from,
        to,
        centerX - halfWidth,
        centerX + halfWidth,
        centerZ - halfDepth,
        centerZ + halfDepth,
      )
    ) {
      return false;
    }
  }
  return true;
}

function zoneIdAt(maze: Maze, cell: Vec2): number {
  if (cell.x < 0 || cell.z < 0 || cell.x >= maze.descriptor.width || cell.z >= maze.descriptor.height) return 0;
  return maze.zoneIds[cell.z * maze.descriptor.width + cell.x] || 0;
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * Picks the next room to sweep: prefers zones not visited recently and at a
 * randomized medium distance, so roaming reads as a deliberate floor patrol
 * rather than ping-ponging between the same two rooms.
 */
function chooseRoamGoal(
  maze: Maze,
  brain: EnemyBrain,
  fromCell: Vec2,
  profile: DifficultyProfile,
): Vec2 {
  const currentZoneId = zoneIdAt(maze, fromCell);
  const preferredDistance = (10 + brain.random() * 26) * profile.roamIntensity;
  let best: OfficeZone | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const zone of maze.zones) {
    if (zone.id === currentZoneId) continue;
    const recencyPenalty = brain.recentZones.includes(zone.id) ? 24 : 0;
    const centerX = zone.x + zone.width / 2;
    const centerZ = zone.z + zone.height / 2;
    const manhattan = Math.abs(centerX - fromCell.x) + Math.abs(centerZ - fromCell.z);
    const score = -Math.abs(manhattan - preferredDistance) - recencyPenalty + brain.random() * 6;
    if (score > bestScore) {
      bestScore = score;
      best = zone;
    }
  }
  const zone = best ?? maze.zones[0];
  brain.recentZones.push(zone.id);
  if (brain.recentZones.length > Math.round(6 * profile.roamIntensity)) {
    brain.recentZones.shift();
  }
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const cell = {
      x: zone.x + Math.floor(brain.random() * zone.width),
      z: zone.z + Math.floor(brain.random() * zone.height),
    };
    if (isOpen(maze, cell.x, cell.z)) return cell;
  }
  return fromCell;
}

/**
 * Builds a short corner-checking sweep around a lost stimulus, favouring
 * cells in adjacent zones so the hunter pushes through side openings and
 * neighbouring rooms instead of pacing the same spot.
 */
function buildSearchPoints(
  maze: Maze,
  brain: EnemyBrain,
  around: Vec2,
  profile: DifficultyProfile,
): Vec2[] {
  const center = worldToCell(maze, around);
  const originZone = zoneIdAt(maze, center);
  const picks: { cell: Vec2; score: number }[] = [];
  const attemptCount = Math.round(28 * profile.searchPersistence);
  const pointCount = Math.round(4 * profile.searchPersistence);
  for (let attempt = 0; attempt < attemptCount; attempt += 1) {
    const radius = 2 + brain.random() * ENEMY.searchRadiusCells * profile.searchPersistence;
    const angle = brain.random() * Math.PI * 2;
    const cell = {
      x: Math.round(center.x + Math.sin(angle) * radius),
      z: Math.round(center.z + Math.cos(angle) * radius),
    };
    if (!isOpen(maze, cell.x, cell.z)) continue;
    const adjacentZoneBonus = zoneIdAt(maze, cell) !== originZone ? 2 : 0;
    picks.push({ cell, score: adjacentZoneBonus + brain.random() });
  }
  picks.sort((a, b) => b.score - a.score);
  const chosen: Vec2[] = [];
  for (const pick of picks) {
    if (chosen.length >= pointCount) break;
    if (chosen.some((cell) => Math.abs(cell.x - pick.cell.x) + Math.abs(cell.z - pick.cell.z) < 3)) continue;
    chosen.push(pick.cell);
  }
  return chosen.map((cell) => cellToWorld(maze, cell));
}

function ensurePath(
  maze: Maze,
  brain: EnemyBrain,
  startCell: Vec2,
  goalCell: Vec2,
  dt: number,
  profile: DifficultyProfile,
): void {
  brain.repathCooldown -= dt;
  const goalChanged =
    !brain.goalCell || brain.goalCell.x !== goalCell.x || brain.goalCell.z !== goalCell.z;
  const exhausted = brain.pathIndex >= brain.path.length;
  if (!goalChanged && !exhausted && brain.repathCooldown > 0) return;
  brain.pathSalt = (brain.pathSalt + 0x9e3779b1) >>> 0;
  const cells = findPathCells(maze, startCell, goalCell, {
    wander: PATH_WANDER[brain.state] / profile.roamIntensity,
    salt: brain.pathSalt,
  });
  const halfCell = maze.descriptor.cellSize * 0.22;
  brain.path = cells.map((cell, index) => {
    const point = cellToWorld(maze, cell);
    // Slight in-cell offset bends the route so it never tracks dead-center lines.
    if (index === 0 || index === cells.length - 1) return point;
    return {
      x: point.x + (brain.random() - 0.5) * halfCell,
      z: point.z + (brain.random() - 0.5) * halfCell,
    };
  });
  brain.pathIndex = 1;
  brain.goalCell = { ...goalCell };
  brain.repathCooldown =
    (PATH_COMMIT[brain.state] * (0.8 + brain.random() * 0.5)) / profile.roamIntensity;
}

export function updateEnemy(
  maze: Maze,
  enemy: EnemyState,
  players: PlayerState[],
  dt: number,
  brain: EnemyBrain,
  profile: DifficultyProfile = DIFFICULTY_PROFILES.easy,
): EnemyUpdate {
  const living = players.filter((player) => player.life === "alive");
  const proximityFactor = teamProximityFactor(players);
  const scale = enemyScaleForProximity(proximityFactor);
  if (living.length === 0 || enemy.mode === "stomped") {
    return { enemy: { ...enemy, scale }, proximityFactor, contactedPlayerId: null };
  }

  // --- Perception -----------------------------------------------------------
  const visible = living.filter(
    (player) =>
      distance(enemy.position, player.position) <=
        ENEMY.detectionRange * profile.detectionPressure &&
      hasLineOfSight(maze, enemy.position, player.position),
  );

  const velocities = new Map<string, Vec2>();
  let heard: Vec2 | null = null;
  for (const player of living) {
    const previous = brain.lastPlayerPositions.get(player.id);
    const velocity = previous
      ? {
          x: (player.position.x - previous.x) / Math.max(dt, 0.0001),
          z: (player.position.z - previous.z) / Math.max(dt, 0.0001),
        }
      : { x: 0, z: 0 };
    velocities.set(player.id, velocity);
    const speed = Math.hypot(velocity.x, velocity.z);
    const loudness = Math.min(1.5, speed / GAME_CONFIG.player.walkSpeed);
    if (
      speed > GAME_CONFIG.player.walkSpeed * 0.5 &&
      distance(enemy.position, player.position) <=
        ENEMY.hearingRange * loudness * profile.detectionPressure
    ) {
      // Footstep stimulus with positional error: it knows roughly, not exactly.
      heard = {
        x: player.position.x + (brain.random() - 0.5) * 3,
        z: player.position.z + (brain.random() - 0.5) * 3,
      };
    }
    brain.lastPlayerPositions.set(player.id, { ...player.position });
  }

  // --- Target selection (isolated players score better) ----------------------
  let target = visible[0] ?? living.find((player) => player.id === enemy.targetId) ?? living[0];
  let targetScore = Number.POSITIVE_INFINITY;
  for (const player of visible) {
    const nearestAlly = living.reduce<number>((nearest, ally) => {
      if (ally.id === player.id) return nearest;
      return Math.min(nearest, distance(player.position, ally.position));
    }, ENEMY.fullStrengthDistance);
    const score = distance(enemy.position, player.position) - nearestAlly * 0.25;
    if (score < targetScore) {
      target = player;
      targetScore = score;
    }
  }
  const seesTarget = visible.some((player) => player.id === target.id);

  // --- Memory and state transitions ------------------------------------------
  const memoryRemaining = seesTarget
    ? ENEMY.memorySeconds * profile.chaseCommitment
    : Math.max(0, enemy.memoryRemaining - dt);
  let lastSeenPosition = seesTarget ? { ...target.position } : enemy.lastSeenPosition;

  if (seesTarget) {
    brain.state = distance(enemy.position, target.position) <= ENEMY.attackRange ? "attack" : "chase";
    brain.searchQueue.length = 0;
  } else if (brain.state === "chase" || brain.state === "attack") {
    // Lost sight: press to last known position, then start a sweep.
    brain.state = memoryRemaining > 0 ? "chase" : "investigate";
  }

  if (heard && brain.state !== "chase" && brain.state !== "attack") {
    brain.state = "investigate";
    lastSeenPosition = heard;
  }

  if (brain.state === "investigate") {
    if (!lastSeenPosition) {
      brain.state = "roam";
    } else if (distance(enemy.position, lastSeenPosition) <= GOAL_REACH) {
      brain.searchQueue = buildSearchPoints(maze, brain, lastSeenPosition, profile);
      brain.searchTimer = ENEMY.searchDuration * profile.searchPersistence;
      brain.state = brain.searchQueue.length > 0 ? "search" : "roam";
      if (brain.state === "roam") lastSeenPosition = null;
    }
  }

  if (brain.state === "search") {
    brain.searchTimer -= dt;
    while (
      brain.searchQueue.length > 0 &&
      distance(enemy.position, brain.searchQueue[0]) <= GOAL_REACH
    ) {
      brain.searchQueue.shift();
    }
    if (brain.searchQueue.length === 0 || brain.searchTimer <= 0) {
      brain.state = "roam";
      brain.searchQueue.length = 0;
      lastSeenPosition = null;
    }
  }

  const startCell = worldToCell(maze, enemy.position);
  if (brain.state === "roam") {
    brain.roamTimer -= dt;
    const arrived =
      brain.goalCell !== null &&
      distance(enemy.position, cellToWorld(maze, brain.goalCell)) <= GOAL_REACH;
    if (!brain.goalCell || arrived || brain.roamTimer <= 0) {
      brain.goalCell = chooseRoamGoal(maze, brain, startCell, profile);
      brain.roamTimer = (12 + brain.random() * 10) / profile.roamIntensity;
      brain.repathCooldown = 0;
    }
  }

  // --- Navigation -------------------------------------------------------------
  let steerPoint: Vec2;
  if (brain.state === "attack") {
    // Direct pressure with a small lead on the target's motion.
    const lead = velocities.get(target.id) ?? { x: 0, z: 0 };
    steerPoint = {
      x: target.position.x + lead.x * 0.2,
      z: target.position.z + lead.z * 0.2,
    };
    brain.path = [];
    brain.pathIndex = 0;
    brain.goalCell = null;
  } else {
    const goalWorld =
      brain.state === "chase"
        ? (seesTarget ? target.position : lastSeenPosition) ?? target.position
        : brain.state === "investigate"
          ? lastSeenPosition!
          : brain.state === "search"
            ? brain.searchQueue[0] ?? enemy.position
            : cellToWorld(maze, brain.goalCell ?? startCell);
    ensurePath(maze, brain, startCell, worldToCell(maze, goalWorld), dt, profile);
    while (
      brain.pathIndex < brain.path.length &&
      distance(enemy.position, brain.path[brain.pathIndex]) <= WAYPOINT_REACH
    ) {
      brain.pathIndex += 1;
    }
    steerPoint = brain.path[brain.pathIndex] ?? goalWorld;
  }

  // --- Human-like locomotion ---------------------------------------------------
  brain.jitterTimer -= dt;
  if (brain.jitterTimer <= 0) {
    brain.speedJitter = 0.8 + brain.random() * 0.35;
    brain.jitterTimer = 1.5 + brain.random() * 2.5;
  }
  brain.wanderPhase += dt * (1.1 + 0.4 * Math.sin(brain.wanderPhase * 0.37));

  const toPoint = { x: steerPoint.x - enemy.position.x, z: steerPoint.z - enemy.position.z };
  const pointDistance = Math.hypot(toPoint.x, toPoint.z);
  const urgent = brain.state === "chase" || brain.state === "attack";
  const wanderOffset = Math.sin(brain.wanderPhase) * WANDER_AMPLITUDE[brain.state];
  const desiredHeading =
    pointDistance > 0.05 ? Math.atan2(toPoint.x, toPoint.z) + wanderOffset : brain.heading;

  // Turn inertia: the body rotates at a capped rate, so sharp corners produce
  // a curved, slightly overshooting arc that is then corrected.
  const turnRate = urgent ? ENEMY.chaseTurnRate : ENEMY.turnRate;
  const headingError = wrapAngle(desiredHeading - brain.heading);
  const maxTurn = turnRate * dt;
  brain.heading = wrapAngle(brain.heading + Math.max(-maxTurn, Math.min(maxTurn, headingError)));

  // Speed shaping: jittered base speed, braking into turns, easing near goals.
  const jitter = urgent ? (brain.speedJitter + 2) / 3 : brain.speedJitter;
  let targetSpeed = BASE_SPEED[brain.state] * jitter * (0.55 + scale * 0.45);
  const alignment = Math.max(0, Math.cos(headingError));
  targetSpeed *= 0.45 + 0.55 * alignment;
  if (!urgent) {
    const goalDistance =
      brain.goalCell !== null
        ? distance(enemy.position, cellToWorld(maze, brain.goalCell))
        : pointDistance;
    targetSpeed *= Math.max(0.3, Math.min(1, goalDistance / 1.8));
  }

  // Acceleration/deceleration: velocity eases toward the heading direction.
  const accel = urgent ? ENEMY.chaseAcceleration : ENEMY.acceleration;
  const desiredVelocity = {
    x: Math.sin(brain.heading) * targetSpeed,
    z: Math.cos(brain.heading) * targetSpeed,
  };
  const blend = Math.min(1, accel * dt);
  brain.velocity.x += (desiredVelocity.x - brain.velocity.x) * blend;
  brain.velocity.z += (desiredVelocity.z - brain.velocity.z) * blend;

  const delta = { x: brain.velocity.x * dt, z: brain.velocity.z * dt };
  const intended = Math.hypot(delta.x, delta.z);
  const position = moveWithCollision(maze, enemy.position, delta, ENEMY.radius);
  const actual = distance(position, enemy.position);

  // Obstacle awareness: shoulder-checks against pillars/dividers trigger a
  // sidestep nudge and, if persistent, a fresh detour route.
  if (intended > 0.01 && actual < intended * 0.35) {
    brain.blockedTime += dt;
    brain.velocity.x *= 0.4;
    brain.velocity.z *= 0.4;
    if (brain.blockedTime > 0.35) {
      brain.heading = wrapAngle(brain.heading + (brain.random() - 0.5) * 1.6);
      brain.repathCooldown = 0;
      brain.blockedTime = 0;
    }
  } else {
    brain.blockedTime = Math.max(0, brain.blockedTime - dt * 2);
  }

  const mode = brain.state;
  const tracking = mode === "chase" || mode === "attack";
  const contactRange = ENEMY.contactRange * Math.max(0.55, scale);
  const contactedPlayer = living.find((player) => distance(position, player.position) <= contactRange);

  return {
    enemy: {
      id: enemy.id,
      position,
      yaw: brain.heading,
      scale,
      mode,
      targetId: tracking ? target.id : null,
      lastSeenPosition,
      memoryRemaining,
    },
    proximityFactor,
    contactedPlayerId: contactedPlayer?.id ?? null,
  };
}
