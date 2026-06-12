import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../shared/config";
import type { ClutterInstance } from "../maze/generateMaze";
import { selectedSplatIndexes } from "./ClutterVisuals";

describe("clutter splat budgeting", () => {
  it("selects every allowed clutter instance at the configured per-asset cap", () => {
    const clutter: ClutterInstance[] = Array.from(
      { length: GAME_CONFIG.clutter.maxInstances },
      (_, index) => ({
        assetId: "desk",
        x: index * 4,
        z: 0,
        y: 0,
        yaw: 0,
        tiltAxis: 0,
        tiltAngle: 0,
        scale: 1,
        featureIndex: index,
      }),
    );

    expect(selectedSplatIndexes(clutter).size).toBe(clutter.length);
  });
});
