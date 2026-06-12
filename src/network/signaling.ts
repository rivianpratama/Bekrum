export interface RoomSession {
  code: string;
  playerId: string;
  token: string;
  hostId: string;
  local: boolean;
}

export interface SignalEnvelope {
  id: string;
  senderId: string;
  data: unknown;
}

const localChannels = new Map<string, BroadcastChannel>();
const localListeners = new Map<string, SignalEnvelope[]>();
const LOCAL_ROOMS_KEY = "bekrum.local.rooms";

function randomCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function localRooms(): Record<string, { hostId: string; players: Record<string, string>; createdAt: number }> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ROOMS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveLocalRooms(rooms: ReturnType<typeof localRooms>): void {
  localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(rooms));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let result: unknown;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      throw new Error(text.trim() || `Coordination request failed (${response.status}).`);
    }
    throw new Error("Coordination service returned an invalid response.");
  }
  if (!response.ok) {
    const error =
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `Coordination request failed (${response.status}).`;
    throw new Error(error);
  }
  return result as T;
}

export async function createRoom(name: string): Promise<RoomSession> {
  try {
    return { ...(await post<Omit<RoomSession, "local">>("/api/room/create", { name })), local: false };
  } catch {
    const rooms = localRooms();
    const code = randomCode(6);
    const playerId = crypto.randomUUID();
    rooms[code] = { hostId: playerId, players: { [playerId]: name }, createdAt: Date.now() };
    saveLocalRooms(rooms);
    return { code, playerId, token: randomCode(24), hostId: playerId, local: true };
  }
}

export async function joinRoom(code: string, name: string): Promise<RoomSession> {
  const normalized = code.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  try {
    return {
      ...(await post<Omit<RoomSession, "local">>("/api/room/join", { code: normalized, name })),
      local: false,
    };
  } catch (httpError) {
    const rooms = localRooms();
    const room = rooms[normalized];
    if (!room) throw httpError;
    if (Object.keys(room.players).length >= 6) {
      throw new Error("The room is full.", { cause: httpError });
    }
    const playerId = crypto.randomUUID();
    room.players[playerId] = name;
    saveLocalRooms(rooms);
    return { code: normalized, playerId, token: randomCode(24), hostId: room.hostId, local: true };
  }
}

function localChannel(session: RoomSession): BroadcastChannel {
  let channel = localChannels.get(session.playerId);
  if (!channel) {
    channel = new BroadcastChannel(`bekrum:${session.code}`);
    localChannels.set(session.playerId, channel);
    localListeners.set(session.playerId, []);
    channel.onmessage = (event: MessageEvent<SignalEnvelope & { recipientId: string }>) => {
      if (event.data.recipientId === session.playerId) localListeners.get(session.playerId)?.push(event.data);
    };
  }
  return channel;
}

export async function pushSignal(
  session: RoomSession,
  recipientId: string,
  data: unknown,
): Promise<void> {
  if (session.local) {
    localChannel(session).postMessage({
      id: crypto.randomUUID(),
      senderId: session.playerId,
      recipientId,
      data,
    });
    return;
  }
  await post("/api/signal/push", { ...session, recipientId, data });
}

export async function pollSignals(session: RoomSession): Promise<SignalEnvelope[]> {
  if (session.local) {
    localChannel(session);
    return localListeners.get(session.playerId)?.splice(0) ?? [];
  }
  const result = await post<{ messages: SignalEnvelope[] }>("/api/signal/poll", session);
  return result.messages;
}

export async function heartbeat(
  session: RoomSession,
  locked?: boolean,
): Promise<Record<string, { name: string }>> {
  if (session.local) {
    return Object.fromEntries(
      Object.entries(localRooms()[session.code]?.players ?? {}).map(([id, name]) => [id, { name }]),
    );
  }
  const result = await post<{ players: Record<string, { name: string }> }>("/api/room/heartbeat", {
    ...session,
    locked,
  });
  return result.players;
}

export async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch("/api/ice");
    const result = await response.json();
    return response.ok ? result.iceServers : [];
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}
