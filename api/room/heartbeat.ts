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

  // Host can report which players are actually connected so stale entries are pruned.
  if (playerId === room.hostId && Array.isArray(req.body?.activePlayers)) {
    const active = new Set<string>(req.body.activePlayers);
    active.add(room.hostId); // Host is always active.
    for (const id of Object.keys(room.players)) {
      if (!active.has(id)) delete room.players[id];
    }
  }

  room.updatedAt = Date.now();
  await writeRoom(room);
  json(res, 200, { players: room.players, hostId: room.hostId, locked: room.locked });
}

