import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heartbeat, pollSignals, pushSignal, type RoomSession } from "./signaling";
import { PeerNetwork } from "./PeerNetwork";

vi.mock("./signaling", () => ({
  getIceServers: vi.fn().mockResolvedValue([]),
  heartbeat: vi.fn().mockResolvedValue({}),
  pollSignals: vi.fn().mockResolvedValue([]),
  pushSignal: vi.fn().mockResolvedValue(undefined),
}));

const hostSession: RoomSession = {
  code: "ABC234",
  playerId: "host",
  token: "host-token",
  hostId: "host",
  local: false,
};

const clientSession: RoomSession = {
  code: "ABC234",
  playerId: "client",
  token: "client-token",
  hostId: "host",
  local: false,
};

describe("PeerNetwork coordination cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps an idle host alive without continuous signal polling", async () => {
    const network = new PeerNetwork(hostSession, vi.fn(), vi.fn());
    await network.start();

    expect(pollSignals).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_100);

    expect(pollSignals).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    network.stop();
  });

  it("polls quickly while a client is waiting for its host", async () => {
    const network = new PeerNetwork(clientSession, vi.fn(), vi.fn());
    await network.start();

    expect(pushSignal).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(pollSignals).toHaveBeenCalledTimes(3);
    network.stop();
  });

  it("stops client polling after the host control channel is connected", async () => {
    const network = new PeerNetwork(clientSession, vi.fn(), vi.fn());
    await network.start();
    const internals = network as unknown as {
      peers: Map<string, unknown>;
      schedulePoll(delay?: number): void;
    };
    internals.peers.set("host", {
      connection: { connectionState: "connected", close: vi.fn() },
      control: { readyState: "open" },
    });
    internals.schedulePoll();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(pollSignals).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();
    network.stop();
  });
});
