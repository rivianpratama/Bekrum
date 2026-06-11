export type Vec2 = { x: number; z: number };

export type RoomPhase = "lobby" | "loading" | "playing" | "won" | "lost";
export type PlayerLife = "alive" | "downed" | "ghost";
export type EnemyMode = "search" | "chase" | "stomped";

export interface MazeDescriptor {
  seed: number;
  width: number;
  height: number;
  cellSize: number;
  hash: string;
}

export interface PlayerState {
  id: string;
  name: string;
  position: Vec2;
  yaw: number;
  life: PlayerLife;
  isHost: boolean;
  stompHeld: boolean;
}

export interface EnemyState {
  position: Vec2;
  yaw: number;
  scale: number;
  mode: EnemyMode;
  targetId: string | null;
}

export interface GameSnapshot {
  tick: number;
  serverTime: number;
  phase: RoomPhase;
  players: PlayerState[];
  enemy: EnemyState;
  proximityFactor: number;
  stompProgress: number;
}

export interface InputIntent {
  sequence: number;
  forward: number;
  strafe: number;
  yaw: number;
  sprint: boolean;
  stomp: boolean;
  dt: number;
}
