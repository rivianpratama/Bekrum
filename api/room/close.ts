import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, normalizeCode, readRoom, requirePost, roomKey, redis } from "../_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requirePost(req, res)) return;
  const code = normalizeCode(req.body?.code);
  const room = await readRoom(code);
  if (!room || room.hostToken !== String(req.body?.token ?? "")) {
    return json(res, 401, { error: "Only the host can close this room." });
  }
  await redis().del(roomKey(code));
  json(res, 200, { ok: true });
}
