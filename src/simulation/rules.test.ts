import { describe, expect, it } from "vitest";
import type { EnemyState, PlayerState } from "../shared/types";
import { enemyScaleForProximity, isStompReady, teamProximityFactor } from "./rules";

function player(id: string, x: number, z: number): PlayerState {
  return {
    id,
    name: id,
    position: { x, z },
    yaw: 0,
    life: "alive",
    isHost: false,
    stompHeld: true,
  };
}

describe("cooperation rules", () => {
  it("shrinks the enemy when every living player is grouped", () => {
    const grouped = teamProximityFactor([player("a", 0, 0), player("b", 2, 0), player("c", 4, 0)]);
    const split = teamProximityFactor([player("a", 0, 0), player("b", 12, 0)]);
    expect(grouped).toBe(1);
    expect(enemyScaleForProximity(grouped)).toBeCloseTo(0.28);
    expect(split).toBe(0);
  });

  it("requires every living player to be in stomp range", () => {
    const enemy: EnemyState = {
      id: "enemy-1",
      position: { x: 0, z: 0 },
      yaw: 0,
      scale: 0.3,
      mode: "chase",
      targetId: "a",
      lastSeenPosition: null,
      memoryRemaining: 0,
    };
    expect(isStompReady([player("a", 1, 0), player("b", -1, 0)], enemy, 1)).toBe(true);
    expect(isStompReady([player("a", 1, 0), player("b", 4, 0)], enemy, 1)).toBe(false);
  });

  it("excludes ghosts from grouping and stomp requirements", () => {
    const players = [player("a", 0, 0), player("b", 1, 0), { ...player("g", 30, 0), life: "ghost" as const }];
    expect(teamProximityFactor(players)).toBe(1);
  });
});
