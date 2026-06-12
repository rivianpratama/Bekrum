import { useEffect, useMemo, useRef, useState } from "react";
import { Atmosphere } from "../audio/Atmosphere";
import { InputController } from "../input/InputController";
import { generateMaze } from "../maze/generateMaze";
import type { PeerNetwork } from "../network/PeerNetwork";
import { Opcode, type ProtocolMessage } from "../shared/protocol";
import type { GameSnapshot, InputIntent, MazeDescriptor, PlayerState } from "../shared/types";
import { GameRenderer } from "../rendering/GameRenderer";
import { GameSimulation } from "../simulation/GameSimulation";
import { distance } from "../simulation/rules";
import { SoloDebugMap } from "./SoloDebugMap";

interface GameViewProps {
  descriptor: MazeDescriptor;
  localPlayerId: string;
  players: PlayerState[];
  network: PeerNetwork;
  soloDebug: boolean;
  setMessageHandler: (handler: (senderId: string, message: ProtocolMessage) => void) => void;
  onExit: () => void;
}

export function GameView({
  descriptor,
  localPlayerId,
  players,
  network,
  soloDebug,
  setMessageHandler,
  onExit,
}: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [locked, setLocked] = useState(false);
  const [entityCamera, setEntityCamera] = useState(false);
  const isHost = network.isHost;
  const entityCameraAvailable = import.meta.env.DEV;
  const maze = useMemo(
    () => generateMaze(descriptor.seed, descriptor.width, descriptor.height),
    [descriptor.height, descriptor.seed, descriptor.width],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (maze.descriptor.hash !== descriptor.hash) {
      throw new Error("Maze reconstruction failed. Seed hash does not match host.");
    }
    const renderer = new GameRenderer(canvas, maze, localPlayerId);
    const input = new InputController(canvas);
    const audio = new Atmosphere();
    const simulation = isHost ? new GameSimulation(maze, players, soloDebug) : null;
    const initialSnapshot = simulation?.snapshot() ?? null;
    let uiAccumulator = 0;
    const initialLocal = initialSnapshot?.players.find((player) => player.id === localPlayerId);
    if (initialLocal) input.yaw = initialLocal.yaw;
    let lastTime = performance.now();
    let accumulator = 0;
    let snapshotAccumulator = 0;
    let frame = 0;
    let clientIntent: InputIntent | null = null;
    let viewingEntity = false;

    const applySnapshot = (nextSnapshot: GameSnapshot, updateUi: boolean) => {
      renderer.setSnapshot(nextSnapshot, input.pitch);
      const localPlayer = nextSnapshot.players.find((player) => player.id === localPlayerId);
      audio.setAggro(
        (nextSnapshot.enemy.mode === "chase" || nextSnapshot.enemy.mode === "attack") &&
          nextSnapshot.enemy.targetId === localPlayerId,
      );
      audio.updateFootsteps(
        localPlayer?.position ?? null,
        localPlayer?.life === "alive" && nextSnapshot.phase === "playing",
      );
      if (updateUi) setSnapshot(nextSnapshot);
    };

    if (initialSnapshot) applySnapshot(initialSnapshot, true);

    setMessageHandler((senderId, message) => {
      if (message[0] === Opcode.PLAYER_INPUT && simulation) {
        simulation.applyInput(senderId, message[1]);
      }
      if (message[0] === Opcode.SNAPSHOT && !simulation) {
        applySnapshot(message[1], true);
      }
    });

    const onPointerLock = () => setLocked(document.pointerLockElement === canvas);
    const onCameraToggle = (event: KeyboardEvent) => {
      if (!entityCameraAvailable || event.code !== "KeyV" || event.repeat) return;
      event.preventDefault();
      viewingEntity = !viewingEntity;
      renderer.setEntityCamera(viewingEntity);
      setEntityCamera(viewingEntity);
    };
    document.addEventListener("pointerlockchange", onPointerLock);
    window.addEventListener("keydown", onCameraToggle);
    canvas.addEventListener("click", () => {
      input.lock();
      audio.start();
    });

    const tick = (now: number) => {
      const elapsed = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      accumulator += elapsed;
      snapshotAccumulator += elapsed;
      uiAccumulator += elapsed;
      const step = 1 / 20;
      while (accumulator >= step) {
        const intent = input.sample(step);
        if (simulation) {
          simulation.applyInput(localPlayerId, intent);
          simulation.update(step);
          applySnapshot(simulation.snapshot(), uiAccumulator >= 0.1);
          if (uiAccumulator >= 0.1) uiAccumulator = 0;
        } else {
          clientIntent = intent;
          network.send([Opcode.PLAYER_INPUT, intent], network.session.hostId);
        }
        accumulator -= step;
      }
      if (simulation && snapshotAccumulator >= 0.1) {
        network.send([Opcode.SNAPSHOT, simulation.snapshot()]);
        snapshotAccumulator = 0;
      }
      renderer.setLook(input.yaw, input.pitch);
      void clientIntent;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerlockchange", onPointerLock);
      window.removeEventListener("keydown", onCameraToggle);
      input.dispose();
      renderer.dispose();
      audio.dispose();
    };
  }, [
    descriptor.hash,
    entityCameraAvailable,
    isHost,
    localPlayerId,
    maze,
    network,
    players,
    setMessageHandler,
    soloDebug,
  ]);

  const local = snapshot?.players.find((player) => player.id === localPlayerId);
  const grouped = (snapshot?.proximityFactor ?? 0) >= 0.9;
  const stompReady =
    grouped &&
    (snapshot?.enemy.scale ?? 1) <= 0.35 &&
    (snapshot?.players.filter((player) => player.life === "alive").every(
      (player) => snapshot && distance(player.position, snapshot.enemy.position) <= 2.5,
    ) ?? false) &&
    (snapshot?.stompProgress ?? 0) < 1;
  const result = snapshot?.phase === "won" ? "VICTORY" : snapshot?.phase === "lost" ? "DEFEAT" : null;
  const debug = new URLSearchParams(window.location.search).has("debug");

  return (
    <main className="game-shell">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label={entityCamera ? "Enemy third person view" : "First person game view"}
      />
      <div
        className={`vignette ${
          snapshot?.enemy.mode === "chase" || snapshot?.enemy.mode === "attack" ? "is-aggro" : ""
        }`}
      />
      <div className="crosshair" aria-hidden="true" />
      <div className="hud-top">
        <span>OBJECTIVE</span>
        <strong>REGROUP. WEAKEN IT. HOLD E TO STOMP.</strong>
      </div>
      <div className="hud-status">
        <div className={grouped ? "status-good" : ""}>
          <span>TEAM SIGNAL</span>
          <strong>{Math.round((snapshot?.proximityFactor ?? 0) * 100)}%</strong>
        </div>
        <div>
          <span>ENTITY MASS</span>
          <strong>{Math.round((snapshot?.enemy.scale ?? 1) * 100)}%</strong>
        </div>
      </div>
      {snapshot?.enemy.mode === "chase" || snapshot?.enemy.mode === "attack" ? (
        <div className="aggro-alert">IT SEES YOU</div>
      ) : null}
      {entityCameraAvailable ? (
        <div className={`camera-mode ${entityCamera ? "is-entity" : ""}`}>
          <span>{entityCamera ? "ENTITY CAMERA" : "PLAYER CAMERA"}</span>
          <strong><kbd>V</kbd> TOGGLE VIEW</strong>
        </div>
      ) : null}
      {stompReady ? (
        <div className="stomp-prompt">
          HOLD <kbd>E</kbd> TO STOMP
          <span style={{ width: `${(snapshot?.stompProgress ?? 0) * 100}%` }} />
        </div>
      ) : null}
      {local?.life === "ghost" ? (
        <div className="ghost-message">YOU ARE GONE. WALK THROUGH THE WALLS. WATCH QUIETLY.</div>
      ) : null}
      {soloDebug && snapshot ? (
        <SoloDebugMap maze={maze} snapshot={snapshot} localPlayerId={localPlayerId} />
      ) : null}
      {debug && snapshot ? (
        <pre className="debug-overlay">
          {[
            `role ${isHost ? "host" : "peer"}`,
            `tick ${snapshot.tick}`,
            `seed ${descriptor.seed}`,
            `maze ${descriptor.hash}`,
            `players ${snapshot.players.length}`,
            `phase ${snapshot.phase}`,
            `life ${local?.life ?? "missing"}`,
            `camera ${entityCamera ? "entity" : "player"}`,
            `enemy ${snapshot.enemy.mode} ${snapshot.enemy.scale.toFixed(2)}`,
            `range ${local ? distance(local.position, snapshot.enemy.position).toFixed(1) : "-"}`,
            `you ${local ? `${local.position.x.toFixed(1)},${local.position.z.toFixed(1)}` : "-"}`,
            `entity ${snapshot.enemy.position.x.toFixed(1)},${snapshot.enemy.position.z.toFixed(1)}`,
          ].join("\n")}
        </pre>
      ) : null}
      {!locked && !result ? (
        <button className="pointer-lock" onClick={() => canvasRef.current?.click()}>
          CLICK TO ENTER
          <small>
            WASD MOVE · SHIFT RUN · MOUSE LOOK · E STOMP
            {entityCameraAvailable ? " · V ENTITY VIEW" : ""}
          </small>
        </button>
      ) : null}
      {result ? (
        <div className="result-screen">
          <span>{result === "VICTORY" ? "THE HUM HAS STOPPED" : "NO ONE LEFT TOGETHER"}</span>
          <h1>{result}</h1>
          <p>
            {result === "VICTORY"
              ? "You stayed close enough to make it small."
              : "The group broke before the entity did."}
          </p>
          <button onClick={onExit}>LEAVE ROOM</button>
        </div>
      ) : null}
    </main>
  );
}
