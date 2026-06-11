import type { GameSnapshot, InputIntent, MazeDescriptor, PlayerState } from "./types";

export const Opcode = {
  HELLO: 0,
  WELCOME: 1,
  ROSTER: 2,
  PREPARE_GAME: 3,
  MAZE_READY: 4,
  GAME_START: 5,
  PLAYER_LEFT: 6,
  PLAYER_DOWNED: 7,
  STOMP_INTENT: 8,
  GAME_WIN: 9,
  GAME_LOSE: 10,
  ROOM_CLOSED: 11,
  PING: 12,
  PONG: 13,
  ERROR: 14,
  PLAYER_INPUT: 20,
  SNAPSHOT: 21,
  HOST_DISCONNECTED: 22,
} as const;

export type ControlMessage =
  | [typeof Opcode.HELLO, string, string]
  | [typeof Opcode.WELCOME, string, PlayerState[], "host" | "client"]
  | [typeof Opcode.ROSTER, PlayerState[]]
  | [typeof Opcode.PREPARE_GAME, MazeDescriptor]
  | [typeof Opcode.MAZE_READY, string]
  | [typeof Opcode.GAME_START, number]
  | [typeof Opcode.PLAYER_LEFT, string]
  | [typeof Opcode.PLAYER_DOWNED, string]
  | [typeof Opcode.STOMP_INTENT, boolean]
  | [typeof Opcode.GAME_WIN]
  | [typeof Opcode.GAME_LOSE, string]
  | [typeof Opcode.ROOM_CLOSED, string]
  | [typeof Opcode.PING, number]
  | [typeof Opcode.PONG, number]
  | [typeof Opcode.ERROR, string]
  | [typeof Opcode.HOST_DISCONNECTED];

export type RealtimeMessage =
  | [typeof Opcode.PLAYER_INPUT, InputIntent]
  | [typeof Opcode.SNAPSHOT, GameSnapshot];

export type ProtocolMessage = ControlMessage | RealtimeMessage;

export function encodeMessage(message: ProtocolMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(raw: string): ProtocolMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || typeof value[0] !== "number") return null;
    return value as ProtocolMessage;
  } catch {
    return null;
  }
}
