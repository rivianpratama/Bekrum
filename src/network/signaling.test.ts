import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { joinRoom } from "./signaling";

describe("coordination responses", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces a JSON API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Room not found or expired." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(joinRoom("ABC234", "Peer")).rejects.toThrow(
      "Room not found or expired.",
    );
  });

  it("surfaces a plain-text Vercel function error without JSON parsing noise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("A server error has occurred.", { status: 500 }),
      ),
    );

    await expect(joinRoom("ABC234", "Peer")).rejects.toThrow(
      "A server error has occurred.",
    );
  });
});
