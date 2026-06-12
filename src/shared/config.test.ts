import { describe, expect, it } from "vitest";
import { DIFFICULTY_PROFILES } from "./config";

describe("difficulty profiles", () => {
  it("keeps easy as the baseline and scales every aggression control upward", () => {
    expect(DIFFICULTY_PROFILES.easy).toEqual({
      enemyCount: 1,
      roamIntensity: 1,
      searchPersistence: 1,
      chaseCommitment: 1,
      detectionPressure: 1,
    });
    expect(DIFFICULTY_PROFILES.medium.enemyCount).toBe(5);
    expect(DIFFICULTY_PROFILES.hard.enemyCount).toBe(10);

    for (const key of [
      "roamIntensity",
      "searchPersistence",
      "chaseCommitment",
      "detectionPressure",
    ] as const) {
      expect(DIFFICULTY_PROFILES.medium[key]).toBeGreaterThan(
        DIFFICULTY_PROFILES.easy[key],
      );
      expect(DIFFICULTY_PROFILES.hard[key]).toBeGreaterThan(
        DIFFICULTY_PROFILES.medium[key],
      );
    }
  });
});
