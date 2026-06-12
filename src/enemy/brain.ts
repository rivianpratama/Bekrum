import { createRandom } from "../maze/random";
import type { Vec2 } from "../shared/types";

/**
 * Hunter decision states. "attack" is contact-pressure range chasing;
 * the networked EnemyMode mirrors these values one-to-one.
 */
export type HunterState = "roam" | "investigate" | "search" | "chase" | "attack";

/**
 * Host-only mutable AI memory. None of this is networked: peers only ever
 * receive the resulting EnemyState inside snapshots, so the host stays
 * authoritative over every enemy decision.
 */
export interface EnemyBrain {
  state: HunterState;
  /** Smoothed facing angle. Velocity chases this, producing turn inertia. */
  heading: number;
  velocity: Vec2;
  /** Current world-space waypoint chain. */
  path: Vec2[];
  pathIndex: number;
  goalCell: Vec2 | null;
  /** Direction commitment: no repath until this elapses (or we get blocked). */
  repathCooldown: number;
  /** Changes per repath so route noise picks different side corridors. */
  pathSalt: number;
  /** Multiplier retimed every few seconds so speed never looks scripted. */
  speedJitter: number;
  jitterTimer: number;
  wanderPhase: number;
  blockedTime: number;
  roamTimer: number;
  /** Recently visited zone ids, so roaming sweeps new rooms first. */
  recentZones: number[];
  /** World points still to be checked while searching around a stimulus. */
  searchQueue: Vec2[];
  searchTimer: number;
  /** Previous tick positions, used to estimate player speed for hearing. */
  lastPlayerPositions: Map<string, Vec2>;
  random: () => number;
}

export function createEnemyBrain(seed: number): EnemyBrain {
  return {
    state: "roam",
    heading: 0,
    velocity: { x: 0, z: 0 },
    path: [],
    pathIndex: 0,
    goalCell: null,
    repathCooldown: 0,
    pathSalt: seed >>> 0,
    speedJitter: 1,
    jitterTimer: 0,
    wanderPhase: (seed % 97) * 0.13,
    blockedTime: 0,
    roamTimer: 0,
    recentZones: [],
    searchQueue: [],
    searchTimer: 0,
    lastPlayerPositions: new Map(),
    random: createRandom(seed ^ 0x5f3759df),
  };
}
