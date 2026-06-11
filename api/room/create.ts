import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, randomId, requirePost, roomKey, type RoomRecord, writeRoom, redis } from "../_shared";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requirePost(req, res)) return;
  try {
    const name = String(req.body?.name ?? "Host").trim().slice(0, 18) || "Host";
    const store = redis();
    let code = randomId(6);
    while (await store.exists(roomKey(code))) code = randomId(6);
    const hostId = randomId(12);
    const hostToken = randomId(24);
    const now = Date.now();
    const room: RoomRecord = {
      code,
      hostId,
      hostToken,
      players: { [hostId]: { name, token: hostToken, joinedAt: now } },
      locked: false,
      updatedAt: now,
    };
    await writeRoom(room);
    json(res, 200, { code, playerId: hostId, token: hostToken, hostId });
  } catch (error) {
    json(res, 503, { error: error instanceof Error ? error.message : "Room service unavailable." });
  }
}
