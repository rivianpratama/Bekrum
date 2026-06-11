import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

export const ROOM_TTL_SECONDS = 60 * 30;
export const SIGNAL_TTL_SECONDS = 60;

export interface RoomRecord {
  code: string;
  hostId: string;
  hostToken: string;
  players: Record<string, { name: string; token: string; joinedAt: number }>;
  locked: boolean;
  updatedAt: number;
}

export function redis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Room coordination is not configured.");
  return new Redis({ url, token });
}

export function roomKey(code: string): string {
  return `bekrum:room:${code}`;
}

export function signalKey(code: string, recipientId: string): string {
  return `bekrum:signal:${code}:${recipientId}`;
}

export function normalizeCode(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

export function randomId(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

export function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).setHeader("Cache-Control", "no-store").json(body);
}

export function requirePost(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === "POST") return true;
  json(res, 405, { error: "Method not allowed." });
  return false;
}

export async function readRoom(code: string): Promise<RoomRecord | null> {
  return redis().get<RoomRecord>(roomKey(code));
}

export async function writeRoom(room: RoomRecord): Promise<void> {
  await redis().set(roomKey(room.code), room, { ex: ROOM_TTL_SECONDS });
}

export function authenticatedPlayer(room: RoomRecord, playerId: string, token: string): boolean {
  return room.players[playerId]?.token === token;
}
