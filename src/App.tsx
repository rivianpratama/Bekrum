import { useCallback, useEffect, useRef, useState } from "react";
import { GameView } from "./game/GameView";
import { generateMaze } from "./maze/generateMaze";
import { PeerNetwork } from "./network/PeerNetwork";
import { createRoom, joinRoom, type RoomSession } from "./network/signaling";
import { MAP_SIZE_DIMENSIONS } from "./shared/config";
import { Opcode, type ProtocolMessage } from "./shared/protocol";
import type { MapSize, MazeDescriptor, PlayerState } from "./shared/types";
import { Lobby } from "./ui/Lobby";

function supportsGame(): boolean {
  return Boolean(window.RTCPeerConnection && window.WebGL2RenderingContext && document.body.requestPointerLock);
}

export default function App() {
  const allowSoloDebug =
    import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug");
  const [name, setName] = useState(() => `Wanderer ${Math.floor(Math.random() * 90 + 10)}`);
  const [code, setCode] = useState("");
  const [session, setSession] = useState<RoomSession | null>(null);
  const [network, setNetwork] = useState<PeerNetwork | null>(null);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [descriptor, setDescriptor] = useState<MazeDescriptor | null>(null);
  const [mapSize, setMapSize] = useState<MapSize>("large");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(supportsGame() ? "" : "This browser lacks WebRTC, WebGL2, or Pointer Lock.");
  const handlerRef = useRef<(senderId: string, message: ProtocolMessage) => void>(() => undefined);

  const setMessageHandler = useCallback(
    (handler: (senderId: string, message: ProtocolMessage) => void) => {
      handlerRef.current = handler;
    },
    [],
  );

  useEffect(() => () => network?.stop(), [network]);

  const enterRoom = async (nextSession: RoomSession) => {
    const ownPlayer: PlayerState = {
      id: nextSession.playerId,
      name: name.trim() || "Wanderer",
      position: { x: 0, z: 0 },
      yaw: 0,
      life: "alive",
      isHost: nextSession.playerId === nextSession.hostId,
      stompHeld: false,
    };
    setSession(nextSession);
    setPlayers([ownPlayer]);

    const peer = new PeerNetwork(
      nextSession,
      (senderId, message) => {
        if (message[0] === Opcode.HELLO && nextSession.playerId === nextSession.hostId) {
          setPlayers((current) => {
            if (current.some((player) => player.id === senderId)) return current;
            const joined: PlayerState = {
              id: senderId,
              name: message[1],
              position: { x: 0, z: 0 },
              yaw: 0,
              life: "alive",
              isHost: false,
              stompHeld: false,
            };
            const next = [...current, joined];
            peer.send([Opcode.WELCOME, senderId, next, "client"], senderId);
            peer.send([Opcode.ROSTER, next]);
            return next;
          });
          return;
        }
        if (message[0] === Opcode.WELCOME || message[0] === Opcode.ROSTER) {
          setPlayers(message[0] === Opcode.WELCOME ? message[2] : message[1]);
          return;
        }
        if (message[0] === Opcode.PREPARE_GAME) {
          const maze = generateMaze(message[1].seed, message[1].width, message[1].height);
          if (maze.descriptor.hash !== message[1].hash) {
            setError("Maze seed mismatch. Rejoin the room.");
            return;
          }
          setDescriptor(message[1]);
          peer.send([Opcode.MAZE_READY, maze.descriptor.hash], nextSession.hostId);
          return;
        }
        if (message[0] === Opcode.HOST_DISCONNECTED) {
          setError("The host has been unreachable for 8 seconds. This room is closed.");
          setDescriptor(null);
          return;
        }
        handlerRef.current(senderId, message);
      },
      (_peerId, status) => {
        if (status === "connected" && !peer.isHost) {
          peer.send([Opcode.HELLO, ownPlayer.name, "1"]);
        }
        if (status === "failed") setError("Peer connection failed. Check TURN configuration or firewall.");
        if (status === "disconnected" && !peer.isHost) setError("Host connection lost.");
      },
    );
    setNetwork(peer);
    await peer.start();
  };

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    try {
      await enterRoom(await createRoom(name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create room.");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setBusy(true);
    setError("");
    try {
      await enterRoom(await joinRoom(code, name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join room.");
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () => {
    if (!network || (players.length < 2 && !allowSoloDebug)) return;
    const dimension = MAP_SIZE_DIMENSIONS[mapSize];
    const maze = generateMaze(
      Math.floor(Math.random() * 2_147_483_647),
      dimension,
      dimension,
    );
    network.send([Opcode.PREPARE_GAME, maze.descriptor]);
    window.setTimeout(() => network.send([Opcode.GAME_START, performance.now()]), 400);
    setDescriptor(maze.descriptor);
  };

  const exit = () => {
    network?.stop();
    setNetwork(null);
    setSession(null);
    setDescriptor(null);
    setPlayers([]);
    setError("");
  };

  if (session && network && descriptor) {
    return (
      <GameView
        descriptor={descriptor}
        localPlayerId={session.playerId}
        players={players}
        network={network}
        soloDebug={allowSoloDebug && players.length === 1}
        setMessageHandler={setMessageHandler}
        onExit={exit}
      />
    );
  }

  return (
    <Lobby
      screen={session ? "waiting" : "home"}
      name={name}
      code={code}
      roomCode={session?.code ?? ""}
      players={players}
      isHost={network?.isHost ?? false}
      allowSoloDebug={allowSoloDebug}
      mapSize={mapSize}
      busy={busy}
      error={error}
      onName={setName}
      onCode={setCode}
      onCreate={handleCreate}
      onJoin={handleJoin}
      onMapSize={setMapSize}
      onStart={handleStart}
    />
  );
}
