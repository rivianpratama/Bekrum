import type { FormEvent } from "react";
import type { Difficulty, MapSize, PlayerState } from "../shared/types";

interface LobbyProps {
  screen: "home" | "waiting";
  name: string;
  code: string;
  roomCode: string;
  players: PlayerState[];
  isHost: boolean;
  allowSoloDebug: boolean;
  mapSize: MapSize;
  difficulty: Difficulty;
  busy: boolean;
  error: string;
  onName: (value: string) => void;
  onCode: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onMapSize: (value: MapSize) => void;
  onDifficulty: (value: Difficulty) => void;
  onStart: () => void;
}

export function Lobby(props: LobbyProps) {
  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    props.onJoin();
  };

  if (props.screen === "waiting") {
    return (
      <main className="lobby scene-bg">
        <div className="waiting-stack">
          <h1>WAITING ROOM</h1>
          <section className="waiting-panel">
          <header>
            <div>
              <span>ROOM CODE</span>
              <button
                className="room-code"
                onClick={() => void navigator.clipboard?.writeText(props.roomCode)}
                title="Copy invite code"
              >
                {props.roomCode}
              </button>
            </div>
            <p>WAITING IN THE YELLOW ROOMS</p>
          </header>
          <div className="player-list">
            {props.players.map((player, index) => (
              <div className="player-row" key={player.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{player.name}</strong>
                <em>{player.isHost ? "HOST" : "CONNECTED"}</em>
              </div>
            ))}
            {Array.from({ length: Math.max(0, 6 - props.players.length) }, (_, index) => (
              <div className="player-row is-empty" key={index}>
                <span>{String(props.players.length + index + 1).padStart(2, "0")}</span>
                <strong>EMPTY SIGNAL</strong>
                <em>—</em>
              </div>
            ))}
          </div>
          {props.isHost ? (
            <div className="game-settings">
              <label>
                MAP SIZE
                <select
                  value={props.mapSize}
                  onChange={(event) => props.onMapSize(event.target.value as MapSize)}
                >
                  <option value="small">SMALL - 71 x 71</option>
                  <option value="medium">MEDIUM - 111 x 111</option>
                  <option value="large">LARGE - 151 x 151</option>
                </select>
              </label>
              <label>
                DIFFICULTY
                <select
                  value={props.difficulty}
                  onChange={(event) => props.onDifficulty(event.target.value as Difficulty)}
                >
                  <option value="easy">EASY - 1 ENTITY</option>
                  <option value="medium">MEDIUM - 5 ENTITIES</option>
                  <option value="hard">HARD - 10 ENTITIES</option>
                </select>
              </label>
            </div>
          ) : null}
          <footer>
            <p>
              {props.players.length}/6 CONNECTED
              {props.allowSoloDebug && props.players.length === 1 ? " · SOLO DEBUG" : " · 2 REQUIRED"}
            </p>
            {props.isHost ? (
              <button
                disabled={(!props.allowSoloDebug && props.players.length < 2) || props.busy}
                onClick={props.onStart}
              >
                {props.allowSoloDebug && props.players.length === 1
                  ? "START SOLO DEBUG"
                  : "START DESCENT"}
              </button>
            ) : (
              <span className="waiting-copy">THE HOST DECIDES WHEN TO BEGIN.</span>
            )}
          </footer>
          {props.error ? <div className="form-error">{props.error}</div> : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="lobby scene-bg">
      <section className="entry-panel">
        <h1>BEKRUM</h1>
        <p>Stay together. It gets smaller when you do.</p>
        <label>
          CALLSIGN
          <input
            value={props.name}
            maxLength={18}
            onChange={(event) => props.onName(event.target.value)}
            placeholder="NAME"
          />
        </label>
        <button className="primary-action" disabled={props.busy} onClick={props.onCreate}>
          CREATE ROOM
        </button>
        <div className="or-line">OR JOIN A SIGNAL</div>
        <form onSubmit={submitJoin}>
          <input
            className="code-input"
            value={props.code}
            maxLength={6}
            onChange={(event) => props.onCode(event.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            aria-label="Room code"
          />
          <button disabled={props.busy || props.code.length < 6}>JOIN ROOM</button>
        </form>
        {props.busy ? <div className="connection-state">SEARCHING FOR A CLEAN SIGNAL...</div> : null}
        {props.error ? <div className="form-error">{props.error}</div> : null}
        <small>DESKTOP · WEBRTC · HEADPHONES RECOMMENDED</small>
      </section>
    </main>
  );
}
