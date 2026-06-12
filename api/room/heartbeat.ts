import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticatedPlayer, json, normalizeCode, readRoom, requirePost, writeRoom } from "../_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requirePost(req, res)) return;
  const code = normalizeCode(req.body?.code);
  const playerId = String(req.body?.playerId ?? "");
  const token = String(req.body?.token ?? "");
  const room = await readRoom(code);
  if (!room || !authenticatedPlayer(room, playerId, token)) {
    return json(res, 401, { error: "Room session expired." });
  }
  if (playerId === room.hostId && typeof req.body?.locked === "boolean") room.locked = req.body.locked;
  room.updatedAt = Date.now();
  await writeRoom(room);
  json(res, 200, { players: room.players, hostId: room.hostId, locked: room.locked });
}
