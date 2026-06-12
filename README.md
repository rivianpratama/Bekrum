# BEKRUM

BEKRUM is a lean browser-based cooperative horror prototype. Two to six players enter the
same seeded, distorted yellow office floor, stay close enough to shrink a hunting entity, then hold
`E` together within stomp range to clear the match.

## Architecture

- **Frontend:** React, TypeScript, Vite, and direct Three.js rendering.
- **Authority:** The room host owns player reconciliation, enemy AI, proximity, downs,
  stomp progress, and the final result.
- **Gameplay transport:** A host-star WebRTC topology with one reliable control channel
  and one lossy real-time channel per peer.
- **Coordination:** Short-lived Vercel Functions and Upstash Redis records exchange SDP
  offers, answers, and ICE candidates. No gameplay state is stored there.
- **Local development:** If the coordination API is unavailable, tabs on the same origin
  use `BroadcastChannel` only to bootstrap WebRTC. Gameplay still uses DataChannels.
- **World:** Every peer reconstructs a deterministic room-first office floor from the host
  seed and verifies its FNV-1a topology hash before entering.

The main boundaries are:

```text
src/shared       protocol, types, tuning
src/network      room bootstrap and WebRTC
src/maze         seeded office topology and coordinates
src/simulation   movement, collision, rules, host simulation
src/enemy        host AI and pathfinding
src/rendering    Three.js scene and interpolation
src/assets       enemy visual adapter and fallback
src/input        desktop FPS input
src/audio        procedural fluorescent ambience
src/ui           create/join and waiting room
api              disposable Vercel/Upstash coordination
```

## Room Flow

1. The host creates a six-character invite code.
2. Peers join and signal the host through disposable HTTP-polled messages.
3. The host creates one WebRTC connection per peer.
4. The host starts with a random floor seed and broadcasts the descriptor.
5. Clients regenerate and hash the office layout. Gameplay traffic then remains peer-to-peer.
6. Clients send compact input intents at 20 Hz. The host simulates at 20 Hz and sends
   snapshots at 10 Hz.

There is no host migration or rejoin in v1. If the host is disconnected for eight seconds,
clients close the session with a useful error.

## Protocol

Messages are numeric-opcode JSON tuples. The schema is in
`src/shared/protocol.ts`.

Reliable control messages cover `HELLO`, `WELCOME`, `ROSTER`, `PREPARE_GAME`,
`MAZE_READY`, `GAME_START`, `PLAYER_LEFT`, `PLAYER_DOWNED`, `STOMP_INTENT`,
`GAME_WIN`, `GAME_LOSE`, `ROOM_CLOSED`, heartbeat, errors, and host disconnect.

The unordered real-time channel carries `PLAYER_INPUT` and authoritative `SNAPSHOT`
messages. Values are intentionally small and the room cap is six.

## Office Floor Generation

The default floor is approximately 300 by 300 meters and contains about 50 recursively
subdivided office zones. Thin architectural partitions, offset wide openings, partial
dividers, counters, and pillars interrupt sightlines without carving narrow maze corridors.
Six spawn candidates are selected from different zones using navigation distance, with a
default minimum separation target of 90 meters.

Generation is deterministic and configured in `src/shared/config.ts`: floor dimensions,
major zone count and size, connector width, partition and pillar density, openness,
occlusion, repetition, and spawn separation are all explicit tuning points. The existing
`MazeDescriptor` and protocol opcode names are retained as internal compatibility names.

The host alone runs enemy decisions. Full-height walls, pillars, and sufficiently tall
dividers block enemy sight. After losing sight of a player, the enemy follows the last seen
position for four seconds before returning to zone-based search.

Fluorescent ambience and carpet footsteps are generated with Web Audio after the player
enters pointer lock. Footstep cadence follows authoritative movement distance and becomes
quicker and heavier while running; no external sound asset is required.

Development builds can press `V` during a match to toggle a local third-person camera
behind the entity. The camera follows its authoritative position and facing direction
without changing simulation or network state. This control is absent from production builds.

## Game Rules

- Group strength uses the maximum pairwise distance between all living players.
- The factor is `1` at four meters or less and `0` at twelve meters or more.
- Enemy scale maps linearly from `1.0` down to `0.28`.
- Stomp requires at least two living players, group factor `>= 0.9`, enemy scale
  `<= 0.35`, every living player within 2.5 meters, and every living player holding
  `E` for 0.75 seconds.
- Sustained contact turns a player into an invisible horizontal noclip ghost.
- Ghosts cannot affect grouping, AI targeting, stomp, or the result.
- Fewer than two living players is a defeat.

All tuning lives in `src/shared/config.ts`.

## Enemy Asset

Place the supplied model at:

```text
public/assets/enemy.splat
```

The repository includes a converter for INRIA Gaussian PLY files:

```bash
npm run convert:enemy
```

By default it converts `src/assets/enemy.ply` to `public/assets/enemy.splat`, removes
effectively invisible splats, and sorts the remaining splats by visual importance. Custom
paths can be passed directly:

```bash
node scripts/convert-ply-to-splat.mjs input.ply output.splat
```

The visual is loaded lazily through `@mkkellogg/gaussian-splats-3d`. AI, collision, and
network state do not depend on splat rendering. A dark mesh entity is used when loading
fails, so the match remains playable. The adapter also provides the ownership boundary
for adding a PLY loader without changing simulation code.

The bundled splat is normalized visually to roughly human height and lifted above the
floor. During development, the game canvas exposes `data-enemy-visual="splat"` or
`"fallback"` for quick loader diagnosis.

## Development

Requirements: Node.js 24+ and a modern desktop Chromium or Firefox browser.

```bash
npm install
npm run dev
```

Open two tabs at `http://localhost:5173`, create a room in one, and join from the other.
Append `?debug=1` to show role, tick, seed, maze hash, player count, and enemy state.

In development, a host can press **START SOLO DEBUG** without peers. Solo debug changes
only the defeat threshold from two living players to one so the enemy chase can be tested.
Shrinking and stomping still require multiple players. On a production deployment,
append `?debug=1` to expose the same troubleshooting mode.

Checks:

```bash
npm test
npm run test:e2e
npm run lint
npm run build
```

## Vercel Deployment

Deploy the repository as a Vite project and configure:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ICE_SERVERS_JSON
```

`ICE_SERVERS_JSON` is returned by `/api/ice` and remains server-side. Development falls
back to Google's public STUN service. Reliable internet play requires an external TURN
service with short-lived credentials, for example:

```json
[
  { "urls": "stun:stun.example.com:3478" },
  {
    "urls": ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"],
    "username": "temporary-user",
    "credential": "temporary-credential"
  }
]
```

Room records expire after 30 minutes and signal queues after 60 seconds. Vercel Functions
never relay DataChannel gameplay or run the authoritative simulation.

## Known Limitations

- Desktop keyboard and mouse only.
- Small host-star rooms only; upstream bandwidth grows per peer.
- No host migration, reconnect, persistence, matchmaking, accounts, or anti-cheat beyond
  host authority.
- Browser background throttling can degrade a host's simulation.
- Large splat assets can delay the first enemy render; the fallback remains available.
- The prototype uses lightweight snapshot smoothing, not a full rollback netcode system.
- TURN service cost and credential issuance are deployment responsibilities.
