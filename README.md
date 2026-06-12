<div align="center">
  <h1>BEKRUM</h1>
  <p><strong>A lean, browser-based, cooperative horror prototype.</strong></p>
  
  <p>
    <a href="https://react.dev"><img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" /></a>
    <a href="https://threejs.org"><img src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white" alt="Three.js" /></a>
    <a href="https://webrtc.org"><img src="https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC" /></a>
    <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://vite.dev"><img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" /></a>
    <a href="https://vercel.com"><img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" /></a>
    <a href="https://upstash.com"><img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" /></a>
  </p>
</div>

---

Two to six players enter the same seeded, distorted yellow office floor, stay close enough to shrink the hunting entities, then hold <kbd>E</kbd> together within stomp range to clear the match.

## 📌 Table of Contents

1. [🎮 Core Features](#-core-features)
2. [📁 Architecture & Codebase Boundaries](#-architecture--codebase-boundaries)
3. [🌐 Room Flow & Signaling Coordination](#-room-flow--signaling-coordination)
4. [📐 Office Generation & Clutter System](#-office-generation--clutter-system)
5. [👹 Difficulty & Enemy AI Profiles](#-difficulty--enemy-ai-profiles)
6. [⚖️ Game Rules & Stomp Criteria](#-game-rules--stomp-criteria)
7. [💻 Local Development & Diagnostics](#-local-development--diagnostics)
8. [🚀 Production Deployment](#-production-deployment)
9. [⚠️ Known Limitations](#-known-limitations)

---

## 🎮 Core Features

- **Cooperative Multiplayer:** 2 to 6 players in host-star P2P multiplayer.
- **Procedural Office Generation:** A deterministic, seed-based layout generator (`"office-v3"`) yielding thin architectural partitions, offset wide openings, stubs, alcoves, pillar clusters, and doorway jogs.
- **Adaptive Multi-Enemy AI:** Simulates multiple entities (up to 10 on Hard) with difficulty scaling that changes entity counts, roaming speed, search persistence, chase commitment, and detection ranges.
- **Physical Clutter System:** Seeds 10 unique Gaussian Splat objects (furniture, desks, lamps, beds, etc.) using zone-based archetypes. These objects block player and enemy collision, occlude line of sight, and create pinched corridors or rare "sealed pockets".
- **Dynamic Group Scaling:** Player proximity actively shrinks the scale and strength of chasing entities. Stomping requires coordinates, high proximity, low enemy scale, and coordinated interaction.
- **Procedural Ambience & Footsteps:** Fluorescent light hums and footstep cadence scale procedurally without large external audio assets.

---

## 📁 Architecture & Codebase Boundaries

Gameplay and network responsibility boundaries are organized as follows:

<details>
<summary><b>🔍 Click to expand Directory Map & Source Structure</b></summary>

| Directory | Scope / Purpose |
|---|---|
| `src/shared` | Network protocol, packet types, configuration, and game parameters |
| `src/network` | P2P room bootstrap, signaling client, and WebRTC coordination |
| `src/maze` | Seeded office topology generator, clutter placement engine, and navigation grid |
| `src/simulation` | Movement, collision system, game rules, and host simulation loop |
| `src/enemy` | Host-side AI brain, perception calculations, pathfinding, and behaviors |
| `src/rendering` | Three.js renderer, Gaussian splat loader, interpolation, and visual overlays |
| `src/assets` | Gaussian splat manifests, fallback models, and converter pipelines |
| `src/input` | First-person desktop camera controls and keyboard/mouse intent binding |
| `src/audio` | Procedural fluorescent light hum, footsteps, and spatial sound generation |
| `src/ui` | React interface components (room setup, lobby waiting room, game HUD) |
| `api` | Serverless Vercel function endpoints for Redis signaling exchange |

</details>

---

## 🌐 Room Flow & Signaling Coordination

BEKRUM runs a **host-star P2P topology** utilizing WebRTC DataChannels:

1. **Invite Code:** The host creates a 6-character room code.
2. **Signaling Exchange:** Peers join the room using the code, exchanging SDP signals (offers, answers, and ICE candidates) via serverless Vercel Functions backed by Upstash Redis.
3. **Timeout-Based Cadence:** Polling and heartbeats utilize a scheduled, non-overlapping `setTimeout` structure:
   - `SIGNAL_POLL_INTERVAL_MS = 450`: Rapidly polls for signaling updates during connection bootstrap.
   - `HOST_HEARTBEAT_INTERVAL_MS = 5000`: Hosts periodically ping the Upstash Redis room record to verify room health.
   - **On-Demand Polling:** Polling and heartbeats automatically stop once control channels are established, conserving bandwidth and API usage.
4. **DataChannels:** Gameplay transport employs two WebRTC DataChannels:
   - `control` (Reliable, ordered): Syncs room phases (`lobby`, `loading`, `playing`, `won`, `lost`), players list, and stomp intents.
   - `realtime` (Unreliable, unordered): Relays input intents (client-to-host at 20 Hz) and snapshots (host-to-clients at 10 Hz).
5. **No Migration:** There is no host migration in v1. If the host is lost for 8 seconds, the room session terminates with a timeout error.

---

## 📐 Office Generation & Clutter System

Map layouts are completely deterministic (re-generated on each client using a shared seed and verified via an FNV-1a topology hash):

<details>
<summary><b>🛠️ Click to expand Generation Engine Details</b></summary>

### Map Configuration
- **Dimensions:** Supports **Small** (71x71), **Medium** (111x111), and **Large** (151x151) sizes.
- **Architectural Details:** Features full-height partitions, offset openings, pillar clusters, stubs, alcoves, and S-curve baffle walls (doorway jogs).
- **Connectivity Repair:** An automated pass scans the generated cells and forces openings through blocked doors or columns, guaranteeing that all playable spaces are traversable.
- **Spatial Hash (`featureGrid`):** Optimizes collision checking and line-of-sight raycasts to run in $O(1)$ relative time by bucketing walls and furniture.

### Seeded Clutter (`clutter-v1`)
- **Manifest:** Defined in `src/assets/clutterManifest.ts` containing footprints and tags for 10 unique props (e.g. cabinets, desks, beds, lamps, toppled sofa).
- **Zone Composition:** Zones roll one of five archetypes:
  - `empty`: Zero clutter.
  - `sparse`: Single, awkwardly placed furniture instances.
  - `cluster`: 3-5 props stacked or overlapping.
  - `barricade`: 2-4 items partially blocking corridor corridors.
  - `swallowed`: Extremely dense clutter layout with stacked and toppled props.
- **Doorway Pinches:** Clutter is allowed to pinch doorway entries but is restricted from fully blocking passage (maintaining a minimum clearance corridor).
- **Sealed Pockets:** Up to 2 small zones can be completely sealed behind dense clutter barricades. Their interior cells are marked impassable for AI navigation.
- **Downsampled Gaussian Splats:** Rendered via `@mkkellogg/gaussian-splats-3d` downsampled to `maxSplatsPerAsset` (default 2,500) via `npm run prep:clutter`. Fallback rendering displays solid boxes (`0x8a8473`) if loading fails.

</details>

---

## 👹 Difficulty & Enemy AI Profiles

BEKRUM supports scaling challenges through three distinct difficulty modes configured via `DIFFICULTY_PROFILES` in `src/shared/config.ts`:

| Parameter | Easy | Medium (Recommended) | Hard |
|---|---|---|---|
| **Enemy Count** | 1 | 5 | 10 |
| **Roam Intensity** | 1.00x | 1.35x | 1.75x |
| **Search Persistence** | 1.00x | 1.50x | 2.00x |
| **Chase Commitment** | 1.00x | 1.40x | 1.80x |
| **Detection Pressure** | 1.00x | 1.25x | 1.50x |

### AI Behavior States
- **Roam:** Moves randomly across zones at standard speeds.
- **Investigate:** Investigates nearby sound cues (e.g., player running feet).
- **Chase:** Engages when a player enters the entity's field of view (raycast check). If sight is lost, the entity tracks the last seen coordinate for 4 seconds, then performs a local zone search for 9 seconds before returning to roam.
- **Attack:** Triggers down/ghost transition if the entity maintains contact range (1.05m) for 0.7 seconds.

---

## ⚖️ Game Rules & Stomp Criteria

Survival and stomp success rely on team coordination:

- **Group Strength (Proximity Factor):** Calculated using the maximum pairwise distance between all living players:
  - **1.0 (Max Proximity):** All players are within 4 meters.
  - **0.0 (Min Proximity):** Any player is 12 meters or more away from others.
- **Entity Scaling:** High proximity actively shrinks the size and height of the enemies from `1.0` down to `0.28`.
- **Stomp Execution:**
  - Requires at least two living players.
  - Team proximity factor must be `>= 0.9`.
  - Target enemy scale must be `<= 0.35` (fully shrunken).
  - All living players must be within 2.5 meters of the target enemy.
  - All living players must hold <kbd>E</kbd> together for 0.75 seconds to stomp the entity.
- **Player States:** Sustained contact turns a player into an invisible, noclip ghost. Ghosts cannot trigger stomp mechanics or count toward proximity calculations.
- **Victory & Defeat:**
  - **Victory:** Stomp all spawned entities (1 on Easy, 5 on Medium, 10 on Hard).
  - **Defeat:** Fewer than two living players remain (fewer than one in solo debug).

---

## 💻 Local Development & Diagnostics

### Installation & Run

```bash
# Install dependencies
npm install

# Start local Vite dev server
npm run dev
```

Open two browser tabs at `http://localhost:5173`. Create a room in one tab and join it from the other.

### 🛠️ Developer Diagnostics
- **Debug Overlay:** Append `?debug=1` to the URL to display real-time latency, seeds, entity tracking, role state, and maze hashes.
- **Solo Debug Mode:** In local development, click **START SOLO DEBUG** to test chaser AI without a second player (defeat condition is lowered to 0 remaining living players).
- **Entity View:** Press <kbd>V</kbd> to toggle a third-person camera tracking behind the hunting entity (development mode only).
- **Splat Downsampler:** Truncate high-density splats for performance:
  ```bash
  npm run prep:clutter
  ```
- **Splat Converter:** Convert INRIA PLY format into optimized `.splat` format:
  ```bash
  npm run convert:enemy
  ```

### 🧪 Validation Pipelines

```bash
# Run unit tests (Vitest)
npm test

# Run end-to-end tests (Playwright)
npm run test:e2e

# Run ESLint check
npm run lint

# Build production bundle
npm run build
```

---

## 🚀 Production Deployment

Deploy the project to Vercel (or similar serverless providers) as a standard Vite application. Configure the following environment variables:

| Environment Variable | Description / Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | REST URL of your Upstash Redis database |
| `UPSTASH_REDIS_REST_TOKEN` | REST Token of your Upstash Redis database |
| `ICE_SERVERS_JSON` | A JSON array containing STUN/TURN configurations |

#### Custom `ICE_SERVERS_JSON` format:
```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  {
    "urls": ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"],
    "username": "temporary-username",
    "credential": "temporary-credential"
  }
]
```

---

## ⚠️ Known Limitations

- Desktop keyboard and mouse only.
- Small host-star rooms only; upstream bandwidth grows per peer.
- No host migration, reconnect, persistence, matchmaking, accounts, or anti-cheat beyond host authority.
- Browser background throttling can degrade a host's simulation.
- Large splat assets can delay the first enemy render; the fallback box remains available.
- The prototype uses lightweight snapshot smoothing, not a full rollback netcode system.
- TURN service cost and credential issuance are deployment responsibilities.
