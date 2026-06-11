import { decodeMessage, encodeMessage, Opcode, type ProtocolMessage } from "../shared/protocol";
import type { RoomSession } from "./signaling";
import { getIceServers, heartbeat, pollSignals, pushSignal } from "./signaling";

type MessageHandler = (senderId: string, message: ProtocolMessage) => void;
type StatusHandler = (peerId: string, status: RTCPeerConnectionState) => void;

interface Peer {
  connection: RTCPeerConnection;
  control?: RTCDataChannel;
  realtime?: RTCDataChannel;
}

export class PeerNetwork {
  private peers = new Map<string, Peer>();
  private pollingTimer = 0;
  private heartbeatTimer = 0;
  private stopped = false;
  private disconnectTimers = new Map<string, number>();

  constructor(
    readonly session: RoomSession,
    private readonly onMessage: MessageHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  get isHost(): boolean {
    return this.session.playerId === this.session.hostId;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.poll();
    this.pollingTimer = window.setInterval(() => void this.poll(), 450);
    this.heartbeatTimer = window.setInterval(() => void this.syncRoster(), 2_000);
    if (!this.isHost) await pushSignal(this.session, this.session.hostId, { type: "join" });
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.pollingTimer);
    window.clearInterval(this.heartbeatTimer);
    for (const timer of this.disconnectTimers.values()) window.clearTimeout(timer);
    this.disconnectTimers.clear();
    for (const peer of this.peers.values()) peer.connection.close();
    this.peers.clear();
  }

  send(message: ProtocolMessage, peerId?: string): void {
    const raw = encodeMessage(message);
    const realtime = message[0] === Opcode.PLAYER_INPUT || message[0] === Opcode.SNAPSHOT;
    const sendTo = (peer: Peer) => {
      const channel = realtime ? peer.realtime : peer.control;
      if (channel?.readyState === "open") channel.send(raw);
    };
    if (peerId) {
      const peer = this.peers.get(peerId);
      if (peer) sendTo(peer);
      return;
    }
    for (const peer of this.peers.values()) sendTo(peer);
  }

  private async syncRoster(): Promise<void> {
    try {
      const roster = await heartbeat(this.session);
      if (!this.isHost) return;
      for (const peerId of Object.keys(roster)) {
        if (peerId !== this.session.playerId && !this.peers.has(peerId)) {
          // The explicit join signal normally creates the offer; heartbeat heals missed joins.
          await this.createOffer(peerId);
        }
      }
    } catch {
      // DataChannel heartbeat remains authoritative once connected.
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      for (const signal of await pollSignals(this.session)) {
        const data = signal.data as { type?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
        if (data.type === "join" && this.isHost) await this.createOffer(signal.senderId);
        if (data.type === "offer" && data.sdp) await this.acceptOffer(signal.senderId, data.sdp);
        if (data.type === "answer" && data.sdp) {
          await this.peers.get(signal.senderId)?.connection.setRemoteDescription(data.sdp);
        }
        if (data.type === "candidate" && data.candidate) {
          await this.peers.get(signal.senderId)?.connection.addIceCandidate(data.candidate);
        }
      }
    } catch {
      // Polling retries automatically; UI receives connection state from RTCPeerConnection.
    }
  }

  private async createConnection(peerId: string): Promise<Peer> {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: await getIceServers() });
    const peer: Peer = { connection };
    this.peers.set(peerId, peer);
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        void pushSignal(this.session, peerId, {
          type: "candidate",
          candidate: event.candidate.toJSON(),
        });
      }
    };
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      this.onStatus(peerId, state);
      const existingTimer = this.disconnectTimers.get(peerId);
      if (existingTimer) window.clearTimeout(existingTimer);
      if (state === "connected") {
        this.disconnectTimers.delete(peerId);
      } else if (state === "disconnected" && peerId === this.session.hostId) {
        this.disconnectTimers.set(
          peerId,
          window.setTimeout(() => {
            this.onMessage(peerId, [Opcode.HOST_DISCONNECTED]);
            this.disconnectTimers.delete(peerId);
          }, 8_000),
        );
      }
    };
    connection.ondatachannel = (event) => this.attachChannel(peerId, peer, event.channel);
    return peer;
  }

  private attachChannel(peerId: string, peer: Peer, channel: RTCDataChannel): void {
    if (channel.label === "control") peer.control = channel;
    else peer.realtime = channel;
    channel.onmessage = (event) => {
      const message = decodeMessage(String(event.data));
      if (message) this.onMessage(peerId, message);
    };
    channel.onopen = () => this.onStatus(peerId, "connected");
  }

  private async createOffer(peerId: string): Promise<void> {
    const peer = await this.createConnection(peerId);
    if (peer.connection.signalingState !== "stable" || peer.control) return;
    this.attachChannel(peerId, peer, peer.connection.createDataChannel("control", { ordered: true }));
    this.attachChannel(
      peerId,
      peer,
      peer.connection.createDataChannel("realtime", { ordered: false, maxRetransmits: 0 }),
    );
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    await pushSignal(this.session, peerId, { type: "offer", sdp: offer });
  }

  private async acceptOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const peer = await this.createConnection(peerId);
    await peer.connection.setRemoteDescription(offer);
    const answer = await peer.connection.createAnswer();
    await peer.connection.setLocalDescription(answer);
    await pushSignal(this.session, peerId, { type: "answer", sdp: answer });
  }
}
