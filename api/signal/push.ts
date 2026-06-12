import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  authenticatedPlayer,
  json,
  normalizeCode,
  readRoom,
  requirePost,
  SIGNAL_TTL_SECONDS,
  signalKey,
  redis,
} from "../_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requirePost(req, res)) return;
  const code = normalizeCode(req.body?.code);
  const senderId = String(req.body?.playerId ?? "");
  const recipientId = String(req.body?.recipientId ?? "");
  const room = await readRoom(code);
  if (!room || !authenticatedPlayer(room, senderId, String(req.body?.token ?? ""))) {
    return json(res, 401, { error: "Invalid room session." });
  }
  if (!room.players[recipientId]) return json(res, 404, { error: "Peer is no longer in the room." });
  const payload = { id: `${Date.now()}-${Math.random()}`, senderId, data: req.body?.data };
  const store = redis();
  await store.rpush(signalKey(code, recipientId), payload);
  await store.expire(signalKey(code, recipientId), SIGNAL_TTL_SECONDS);
  json(res, 200, { ok: true });
}
