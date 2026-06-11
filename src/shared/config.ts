export const GAME_CONFIG = {
  room: {
    minPlayers: 2,
    maxPlayers: 6,
    codeLength: 6,
    hostTimeoutMs: 8_000,
  },
  maze: {
    width: 17,
    height: 17,
    cellSize: 4,
    wallHeight: 3.1,
    loopChance: 0.09,
  },
  player: {
    radius: 0.38,
    walkSpeed: 5.2,
    sprintSpeed: 8,
    ghostSpeed: 9,
    eyeHeight: 1.65,
  },
  network: {
    simulationHz: 20,
    inputHz: 20,
    snapshotHz: 10,
    interpolationMs: 100,
  },
  enemy: {
    searchSpeed: 1.7,
    chaseSpeed: 3.15,
    detectionRange: 18,
    contactRange: 1.05,
    contactSecondsToDown: 0.7,
    fullStrengthDistance: 12,
    groupedDistance: 4,
    minScale: 0.28,
  },
  stomp: {
    proximityFactor: 0.9,
    maxEnemyScale: 0.35,
    range: 2.5,
    confirmationSeconds: 0.75,
  },
} as const;

export type GameConfig = typeof GAME_CONFIG;
