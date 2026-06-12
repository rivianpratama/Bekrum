import { describe, expect, it } from "vitest";
import { generateMaze } from "../maze/generateMaze";
import type { PlayerState } from "../shared/types";
import { GameSimulation } from "./GameSimulation";

const soloPlayer: PlayerState = {
  id: "host",
  name: "Host",
  position: { x: 0, z: 0 },
  yaw: 0,
  life: "alive",
  isHost: true,
  stompHeld: false,
};

describe("GameSimulation solo debug", () => {
  it.each([
    ["easy", 1],
    ["medium", 5],
    ["hard", 10],
  ] as const)("spawns %s difficulty with %i distinct enemies", (difficulty, count) => {
    const simulation = new GameSimulation(
      generateMaze(123, 71, 71),
      [soloPlayer],
      true,
      difficulty,
    );
    expect(simulation.enemies).toHaveLength(count);
    expect(
      new Set(simulation.enemies.map((enemy) => `${enemy.position.x},${enemy.position.z}`)).size,
    ).toBe(count);
    simulation.update(1 / 20);
    expect(simulation.phase).toBe("playing");
    expect(simulation.enemies.every((enemy) => enemy.mode !== "stomped")).toBe(true);
  });

  it("keeps a one-player debug match running", () => {
    const simulation = new GameSimulation(generateMaze(123), [soloPlayer], true);
    simulation.update(1 / 20);
    expect(simulation.phase).toBe("playing");
    expect(simulation.enemy.mode).toBe("roam");
    expect(simulation.enemy.targetId).toBeNull();
  });

  it("does not let the enemy reach an idle solo player during the initial safety window", () => {
    const simulation = new GameSimulation(generateMaze(456), [soloPlayer], true);
    for (let tick = 0; tick < 200; tick += 1) simulation.update(1 / 20);
    expect(simulation.phase).toBe("playing");
    expect(simulation.players.get("host")?.life).toBe("alive");
  });

  it("keeps the normal two-player minimum", () => {
    const simulation = new GameSimulation(generateMaze(123), [soloPlayer]);
    simulation.update(1 / 20);
    expect(simulation.phase).toBe("lost");
  });

  it("moves right and left in the camera-relative direction", () => {
    const rightSimulation = new GameSimulation(generateMaze(123), [soloPlayer], true);
    rightSimulation.players.set("host", {
      ...rightSimulation.players.get("host")!,
      life: "ghost",
    });
    const rightStart = rightSimulation.players.get("host")!.position.x;
    rightSimulation.applyInput("host", {
      sequence: 0,
      forward: 0,
      strafe: 1,
      yaw: 0,
      sprint: false,
      stomp: false,
      dt: 0.05,
    });
    expect(rightSimulation.players.get("host")!.position.x).toBeLessThan(rightStart);

    const leftSimulation = new GameSimulation(generateMaze(123), [soloPlayer], true);
    leftSimulation.players.set("host", {
      ...leftSimulation.players.get("host")!,
      life: "ghost",
    });
    const leftStart = leftSimulation.players.get("host")!.position.x;
    leftSimulation.applyInput("host", {
      sequence: 0,
      forward: 0,
      strafe: -1,
      yaw: 0,
      sprint: false,
      stomp: false,
      dt: 0.05,
    });
    expect(leftSimulation.players.get("host")!.position.x).toBeGreaterThan(leftStart);
  });
});
