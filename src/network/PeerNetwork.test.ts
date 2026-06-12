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

  it("uses low-frequency discovery polling while keeping an idle host alive", async () => {
    const network = new PeerNetwork(hostSession, vi.fn(), vi.fn());
    await network.start();

    expect(pollSignals).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_100);

    expect(pollSignals).toHaveBeenCalledTimes(8);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    network.stop();
  });

  it("discovers a remote join signal while the host is idle", async () => {
    vi.mocked(pollSignals)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "join-1", senderId: "client", data: { type: "join" } },
      ]);
    class MockPeerConnection {
      connectionState: RTCPeerConnectionState = "new";
      signalingState: RTCSignalingState = "stable";
      remoteDescription: RTCSessionDescription | null = null;
      onicecandidate: RTCPeerConnection["onicecandidate"] = null;
      onconnectionstatechange: RTCPeerConnection["onconnectionstatechange"] = null;
      ondatachannel: RTCPeerConnection["ondatachannel"] = null;
      createDataChannel = vi.fn(() => ({
        readyState: "connecting",
        send: vi.fn(),
        onmessage: null,
        onopen: null,
      }));
      createOffer = vi.fn().mockResolvedValue({ type: "offer", sdp: "offer-sdp" });
      setLocalDescription = vi.fn().mockResolvedValue(undefined);
      setRemoteDescription = vi.fn().mockResolvedValue(undefined);
      addIceCandidate = vi.fn().mockResolvedValue(undefined);
      close = vi.fn();
    }
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
    const network = new PeerNetwork(hostSession, vi.fn(), vi.fn());
    await network.start();

    await vi.advanceTimersByTimeAsync(2_100);

    expect(pushSignal).toHaveBeenCalledWith(
      hostSession,
      "client",
      { type: "offer", sdp: { type: "offer", sdp: "offer-sdp" } },
    );
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
