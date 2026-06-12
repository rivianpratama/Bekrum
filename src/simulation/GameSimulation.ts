import { createEnemyBrain, type EnemyBrain } from "../enemy/brain";
import { updateEnemy } from "../enemy/updateEnemy";
import { cellToWorld, chooseEnemySpawn, isOpen, type Maze } from "../maze/generateMaze";
import { DIFFICULTY_PROFILES, GAME_CONFIG } from "../shared/config";
import type {
  Difficulty,
  EnemyState,
  GameSnapshot,
  InputIntent,
  PlayerState,
  RoomPhase,
} from "../shared/types";
import { moveWithCollision } from "./collision";
import { isStompReady } from "./rules";

export class GameSimulation {
  readonly players = new Map<string, PlayerState>();
  readonly enemies: EnemyState[] = [];
  phase: RoomPhase = "playing";
  tick = 0;
  proximityFactor = 0;
  stompProgress = 0;
  private contactTimers = new Map<string, number>();
  /** Host-only AI memory; never serialized, keeping the host authoritative. */
  private readonly enemyBrains = new Map<string, EnemyBrain>();

  constructor(
    readonly maze: Maze,
    initialPlayers: PlayerState[],
    private readonly soloDebug = false,
    readonly difficulty: Difficulty = "easy",
  ) {
    const activeSpawnCells: { x: number; z: number }[] = [];
    initialPlayers.forEach((player, index) => {
      const spawnCell = maze.spawnCells[index % maze.spawnCells.length];
      activeSpawnCells.push(spawnCell);
      const spawn = cellToWorld(maze, spawnCell);
      const facing = [
        { x: 0, z: 1, yaw: 0 },
        { x: 1, z: 0, yaw: Math.PI / 2 },
        { x: 0, z: -1, yaw: Math.PI },
        { x: -1, z: 0, yaw: -Math.PI / 2 },
      ].find((direction) => isOpen(maze, spawnCell.x + direction.x, spawnCell.z + direction.z));
      this.players.set(player.id, {
        ...player,
        position: spawn,
        yaw: facing?.yaw ?? 0,
        life: "alive",
        stompHeld: false,
      });
    });
    const occupiedSpawnCells = [...activeSpawnCells];
    const profile = DIFFICULTY_PROFILES[difficulty];
    for (let index = 0; index < profile.enemyCount; index += 1) {
      const enemySpawn = chooseEnemySpawn(maze, occupiedSpawnCells);
      occupiedSpawnCells.push(enemySpawn);
      const id = `enemy-${index + 1}`;
      this.enemies.push({
        id,
        position: cellToWorld(maze, enemySpawn),
        yaw: 0,
        scale: 1,
        mode: "roam",
        targetId: null,
        lastSeenPosition: null,
        memoryRemaining: 0,
      });
      this.enemyBrains.set(
        id,
        createEnemyBrain((maze.descriptor.seed + Math.imul(index, 0x9e3779b1)) >>> 0),
      );
    }
  }

  get enemy(): EnemyState {
    return this.enemies.find((enemy) => enemy.mode !== "stomped") ?? this.enemies[0];
  }

  applyInput(playerId: string, input: InputIntent): void {
    const player = this.players.get(playerId);
    if (!player || player.life === "downed" || this.phase !== "playing") return;
    const speed =
      player.life === "ghost"
        ? GAME_CONFIG.player.ghostSpeed
        : input.sprint
          ? GAME_CONFIG.player.sprintSpeed
          : GAME_CONFIG.player.walkSpeed;
    const length = Math.hypot(input.forward, input.strafe) || 1;
    const forward = input.forward / length;
    const strafe = input.strafe / length;
    const delta = {
      x: (Math.sin(input.yaw) * forward - Math.cos(input.yaw) * strafe) * speed * input.dt,
      z: (Math.cos(input.yaw) * forward + Math.sin(input.yaw) * strafe) * speed * input.dt,
    };
    const position =
      player.life === "ghost"
        ? { x: player.position.x + delta.x, z: player.position.z + delta.z }
        : moveWithCollision(this.maze, player.position, delta, GAME_CONFIG.player.radius);
    this.players.set(playerId, { ...player, position, yaw: input.yaw, stompHeld: input.stomp });
  }

  update(dt: number): void {
    if (this.phase !== "playing") return;
    this.tick += 1;
    const players = [...this.players.values()];
    const contactedPlayerIds = new Set<string>();
    const profile = DIFFICULTY_PROFILES[this.difficulty];
    for (const enemy of this.enemies) {
      const brain = this.enemyBrains.get(enemy.id);
      if (!brain) continue;
      const result = updateEnemy(this.maze, enemy, players, dt, brain, profile);
      Object.assign(enemy, result.enemy);
      this.proximityFactor = result.proximityFactor;
      if (result.contactedPlayerId) contactedPlayerIds.add(result.contactedPlayerId);
    }

    for (const player of this.players.values()) {
      if (player.life !== "alive") continue;
      const contact = contactedPlayerIds.has(player.id);
      const timer = contact ? (this.contactTimers.get(player.id) ?? 0) + dt : 0;
      this.contactTimers.set(player.id, timer);
      if (timer >= GAME_CONFIG.enemy.contactSecondsToDown) {
        this.players.set(player.id, { ...player, life: "ghost", stompHeld: false });
      }
    }

    const currentPlayers = [...this.players.values()];
    const living = currentPlayers.filter((player) => player.life === "alive");
    if (living.length === 0) {
      this.phase = "lost";
      return;
    }
    const stompTarget = this.enemies.find(
      (enemy) =>
        enemy.mode !== "stomped" &&
        isStompReady(currentPlayers, enemy, this.proximityFactor),
    );
    const allHolding = living.every((player) => player.stompHeld);
    this.stompProgress = stompTarget && allHolding
      ? Math.min(1, this.stompProgress + dt / GAME_CONFIG.stomp.confirmationSeconds)
      : Math.max(0, this.stompProgress - dt * 2);
    if (this.stompProgress >= 1 && stompTarget) {
      stompTarget.mode = "stomped";
      stompTarget.targetId = null;
      if (this.enemies.every((enemy) => enemy.mode === "stomped")) {
        this.phase = "won";
      } else {
        this.stompProgress = 0;
      }
    }
  }

  snapshot(): GameSnapshot {
    return {
      tick: this.tick,
      serverTime: performance.now(),
      phase: this.phase,
      players: [...this.players.values()],
      enemies: this.enemies.map((enemy) => ({
        ...enemy,
        position: { ...enemy.position },
        lastSeenPosition: enemy.lastSeenPosition ? { ...enemy.lastSeenPosition } : null,
      })),
      proximityFactor: this.proximityFactor,
      stompProgress: this.stompProgress,
    };
  }
}
