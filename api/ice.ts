import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json } from "./_shared";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const configured = process.env.ICE_SERVERS_JSON;
    const iceServers = configured
      ? JSON.parse(configured)
      : [{ urls: "stun:stun.l.google.com:19302" }];
    json(res, 200, { iceServers });
  } catch {
    json(res, 500, { error: "ICE_SERVERS_JSON is invalid JSON." });
  }
}
