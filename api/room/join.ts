import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, normalizeCode, randomId, readRoom, requirePost, writeRoom } from "../_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requirePost(req, res)) return;
  try {
    const code = normalizeCode(req.body?.code);
    const room = await readRoom(code);
    if (!room) return json(res, 404, { error: "Room not found or expired." });
    if (room.locked) return json(res, 409, { error: "The match has already started." });
    if (Object.keys(room.players).length >= 6) return json(res, 409, { error: "The room is full." });

    const playerId = randomId(12);
    const token = randomId(24);
    const name = String(req.body?.name ?? "Peer").trim().slice(0, 18) || "Peer";
    room.players[playerId] = { name, token, joinedAt: Date.now() };
    room.updatedAt = Date.now();
    await writeRoom(room);
    json(res, 200, { code, playerId, token, hostId: room.hostId });
  } catch (error) {
    json(res, 503, { error: error instanceof Error ? error.message : "Room service unavailable." });
  }
}
