import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json } from "./_shared.js";

const STUN_FALLBACK: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // Prefer Metered.ca dynamic TURN credentials
  const appName = process.env.METERED_APP_NAME;
  const apiKey = process.env.METERED_API_KEY;

  if (appName && apiKey) {
    try {
      const response = await fetch(
        `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      );
      if (response.ok) {
        const iceServers = await response.json();
        return json(res, 200, { iceServers });
      }
    } catch {
      // Fall through to static config or STUN fallback.
    }
  }

  // Fall back to static ICE_SERVERS_JSON env var
  try {
    const configured = process.env.ICE_SERVERS_JSON;
    const iceServers = configured ? JSON.parse(configured) : STUN_FALLBACK;
    json(res, 200, { iceServers });
  } catch {
    json(res, 500, { error: "ICE_SERVERS_JSON is invalid JSON." });
  }
}
