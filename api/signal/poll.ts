import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  authenticatedPlayer,
  json,
  normalizeCode,
  readRoom,
  requirePost,
  signalKey,
  redis,
} from "../_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requirePost(req, res)) return;
  const code = normalizeCode(req.body?.code);
  const playerId = String(req.body?.playerId ?? "");
  const room = await readRoom(code);
  if (!room || !authenticatedPlayer(room, playerId, String(req.body?.token ?? ""))) {
    return json(res, 401, { error: "Invalid room session." });
  }
  const store = redis();
  const key = signalKey(code, playerId);
  const messages = await store.lrange(key, 0, 49);
  if (messages.length > 0) await store.ltrim(key, messages.length, -1);
  json(res, 200, { messages });
}
