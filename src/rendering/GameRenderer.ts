import * as THREE from "three";
import { loadEnemyVisual, type EnemyVisual } from "../assets/EnemyVisual";
import { gridToWorld, type Maze, type OfficeFeatureKind } from "../maze/generateMaze";
import { GAME_CONFIG } from "../shared/config";
import type { GameSnapshot } from "../shared/types";
import { loadClutterVisuals, type ClutterVisuals } from "./ClutterVisuals";

export class GameRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 180);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly playerMeshes = new Map<string, THREE.Mesh>();
  private readonly playerTargets = new Map<string, THREE.Vector2>();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly enemyTargets = new Map<string, THREE.Vector3>();
  private readonly enemyScaleTargets = new Map<string, THREE.Vector3>();
  private readonly enemyPositions = new Map<string, THREE.Vector3>();
  private readonly enemyScales = new Map<string, number>();
  private readonly entityCameraTarget = new THREE.Vector3();
  private readonly entityLookTarget = new THREE.Vector3();
  private enemyVisual: EnemyVisual | null = null;
  private clutterVisuals: ClutterVisuals | null = null;
  private disposed = false;
  private entityCameraEnabled = false;
  private raf = 0;
  private targetSnapshot: GameSnapshot | null = null;
  private lastFrameTime = performance.now();
  private lookYaw = 0;
  private lookPitch = 0;
  private renderScale = Math.min(window.devicePixelRatio, 0.75);
  private performanceSampleStarted = performance.now();
  private performanceSampleFrames = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly maze: Maze,
    private readonly localPlayerId: string,
    private readonly enemyCount: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color(0xd8d0ad);
    this.scene.fog = new THREE.Fog(0xd8d0ad, 38, 76);
    this.camera.rotation.order = "YXZ";
    this.buildMaze();
    void this.attachVisuals();
    window.addEventListener("resize", this.resize);
    this.resize();
    this.render();
  }

  setSnapshot(snapshot: GameSnapshot, pitch: number): void {
    this.targetSnapshot = snapshot;
    const local = snapshot.players.find((player) => player.id === this.localPlayerId);
    if (local) {
      this.cameraTarget.set(local.position.x, GAME_CONFIG.player.eyeHeight, local.position.z);
      if (this.camera.position.lengthSq() === 0) this.camera.position.copy(this.cameraTarget);
      this.setLook(local.yaw, pitch);
    }
    const trackedEnemy =
      snapshot.enemies.find((enemy) => enemy.mode !== "stomped") ?? snapshot.enemies[0];
    if (trackedEnemy) {
      const forwardX = Math.sin(trackedEnemy.yaw);
      const forwardZ = Math.cos(trackedEnemy.yaw);
      const cameraDistance = 4.5 + trackedEnemy.scale;
      this.entityCameraTarget.set(
        trackedEnemy.position.x - forwardX * cameraDistance,
        2.35 + trackedEnemy.scale * 0.45,
        trackedEnemy.position.z - forwardZ * cameraDistance,
      );
      this.entityLookTarget.set(
        trackedEnemy.position.x + forwardX * 5,
        1.15 * trackedEnemy.scale,
        trackedEnemy.position.z + forwardZ * 5,
      );
    }
    for (const player of snapshot.players) {
      if (player.id === this.localPlayerId || player.life === "ghost") continue;
      let mesh = this.playerMeshes.get(player.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.34, 1.05, 4, 8),
          new THREE.MeshStandardMaterial({ color: player.isHost ? 0xe7d96b : 0xa5ab82, roughness: 1 }),
        );
        mesh.position.y = 1;
        this.playerMeshes.set(player.id, mesh);
        this.scene.add(mesh);
      }
      let target = this.playerTargets.get(player.id);
      if (!target) {
        target = new THREE.Vector2(player.position.x, player.position.z);
        this.playerTargets.set(player.id, target);
        mesh.position.set(player.position.x, 1, player.position.z);
      } else {
        target.set(player.position.x, player.position.z);
      }
      mesh.visible = player.life === "alive";
    }
    for (const enemy of snapshot.enemies) {
      let target = this.enemyTargets.get(enemy.id);
      if (!target) {
        target = new THREE.Vector3(enemy.position.x, 0, enemy.position.z);
        this.enemyTargets.set(enemy.id, target);
        this.enemyPositions.set(enemy.id, target.clone());
      } else {
        target.set(enemy.position.x, 0, enemy.position.z);
      }
      let scaleTarget = this.enemyScaleTargets.get(enemy.id);
      if (!scaleTarget) {
        scaleTarget = new THREE.Vector3(enemy.scale, enemy.scale, enemy.scale);
        this.enemyScaleTargets.set(enemy.id, scaleTarget);
        this.enemyScales.set(enemy.id, enemy.scale);
      } else {
        scaleTarget.setScalar(enemy.scale);
      }
    }
  }

  setLook(yaw: number, pitch: number): void {
    this.lookYaw = yaw;
    this.lookPitch = pitch;
  }

  setEntityCamera(enabled: boolean): void {
    this.entityCameraEnabled = enabled;
    this.canvas.dataset.cameraMode = enabled ? "entity" : "player";
    if (enabled) this.camera.position.copy(this.entityCameraTarget);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.enemyVisual?.dispose();
    this.clutterVisuals?.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
  }

  private async attachEnemies(): Promise<void> {
    this.canvas.dataset.enemyCount = this.enemyCount.toString();
    const visual = await loadEnemyVisual(this.enemyCount);
    if (this.disposed) {
      visual.dispose();
      return;
    }
    this.enemyVisual = visual;
    this.canvas.dataset.enemyVisual = visual.usedFallback ? "fallback" : "splat";
    this.canvas.dataset.enemyFallbackCount = visual.usedFallback
      ? this.enemyCount.toString()
      : "0";
    this.targetSnapshot?.enemies.forEach((enemy, index) => {
      visual.setEnemy(
        index,
        enemy.position,
        enemy.yaw,
        enemy.scale,
        enemy.mode !== "stomped",
      );
    });
    this.scene.add(visual.object);
  }

  private async attachVisuals(): Promise<void> {
    await this.attachEnemies();
    if (!this.disposed) await this.attachClutter();
  }

  private async attachClutter(): Promise<void> {
    const startedAt = performance.now();
    let previousFrame = startedAt;
    let maximumFrameGap = 0;
    let monitorFrame: number;
    const monitorLoad = (now: number) => {
      maximumFrameGap = Math.max(maximumFrameGap, now - previousFrame);
      previousFrame = now;
      monitorFrame = requestAnimationFrame(monitorLoad);
    };
    monitorFrame = requestAnimationFrame(monitorLoad);
    const visuals = await loadClutterVisuals(this.maze);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    cancelAnimationFrame(monitorFrame);
    if (this.disposed) {
      visuals.dispose();
      return;
    }
    this.clutterVisuals = visuals;
    this.canvas.dataset.clutterVisual = visuals.status;
    this.canvas.dataset.clutterLoadMs = Math.round(
      performance.now() - startedAt,
    ).toString();
    this.canvas.dataset.clutterMaxFrameGapMs = Math.round(maximumFrameGap).toString();
    this.scene.add(visuals.object);
  }

  private createCeilingTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is required for ceiling tiles.");
    context.fillStyle = "#f4f1df";
    context.fillRect(0, 0, 128, 128);
    context.strokeStyle = "#b9b8ad";
    context.lineWidth = 3;
    context.strokeRect(1.5, 1.5, 125, 125);
    context.fillStyle = "rgba(160, 160, 150, 0.08)";
    for (let index = 0; index < 70; index += 1) {
      const x = (index * 47) % 128;
      const y = (index * 83) % 128;
      context.fillRect(x, y, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  private buildMaze(): void {
    const { width, height, cellSize } = this.maze.descriptor;
    const loader = new THREE.TextureLoader();
    const wallTexture = loader.load("/assets/pale-yellow-surface.png");
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(1, 1);
    const floorTexture = wallTexture.clone();
    floorTexture.needsUpdate = true;
    floorTexture.repeat.set(width, height);

    wallTexture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const wallMaterial = new THREE.MeshBasicMaterial({ map: wallTexture, color: 0xd8c77f });
    const lowMaterial = new THREE.MeshBasicMaterial({ map: wallTexture, color: 0xcbbd7f });
    const pillarMaterial = new THREE.MeshBasicMaterial({ map: wallTexture, color: 0xcfc17c });
    const materialFor = (kind: OfficeFeatureKind) =>
      kind === "wall" ? wallMaterial : kind === "pillar" ? pillarMaterial : lowMaterial;
    const featureGeometry = new THREE.BoxGeometry(1, 1, 1);
    const featureGroups = new Map<OfficeFeatureKind, typeof this.maze.features>();
    for (const feature of this.maze.features) {
      if (feature.kind === "clutter") continue;
      const group = featureGroups.get(feature.kind) ?? [];
      group.push(feature);
      featureGroups.set(feature.kind, group);
    }
    for (const [kind, features] of featureGroups) {
      const mesh = new THREE.InstancedMesh(
        featureGeometry,
        materialFor(kind),
        features.length,
      );
      const matrix = new THREE.Matrix4();
      for (let instance = 0; instance < features.length; instance += 1) {
        const feature = features[instance];
        const center = gridToWorld(this.maze, { x: feature.x, z: feature.z });
        matrix.compose(
          new THREE.Vector3(center.x, feature.height / 2, center.z),
          new THREE.Quaternion(),
          new THREE.Vector3(
            feature.width * cellSize,
            feature.height,
            feature.depth * cellSize,
          ),
        );
        mesh.setMatrixAt(instance, matrix);
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width * cellSize, height * cellSize),
      new THREE.MeshBasicMaterial({ map: floorTexture, color: 0xeee7c9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    this.scene.add(floor);
    const ceilingTexture = this.createCeilingTexture();
    ceilingTexture.repeat.set(width, height);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(width * cellSize, height * cellSize),
      new THREE.MeshBasicMaterial({
        map: ceilingTexture,
        color: 0xffffff,
        side: THREE.DoubleSide,
      }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = GAME_CONFIG.maze.wallHeight;
    this.scene.add(ceiling);

    const zoneOffset = (zoneId: number, multiplier: number) =>
      (((zoneId * multiplier) % 100) / 100) * GAME_CONFIG.maze.ceilingJitter;
    const latticeCount = (spacing: number) =>
      this.maze.zones.reduce((count, zone) => {
        const ox = zoneOffset(zone.id, 7919);
        const oz = zoneOffset(zone.id, 6151);
        return (
          count +
          Math.floor((zone.width - ox) / spacing) +
          1 +
          Math.floor((zone.height - oz) / spacing) +
          1
        );
      }, 0);
    const latticeSpacing = latticeCount(1) > 20_000 ? 2 : 1;
    const lattice = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xb9b8ad }),
      latticeCount(latticeSpacing),
    );
    const latticeTransform = new THREE.Matrix4();
    let latticeInstance = 0;
    for (const zone of this.maze.zones) {
      const ox = zoneOffset(zone.id, 7919);
      const oz = zoneOffset(zone.id, 6151);
      for (
        let x = zone.x + ox;
        x <= zone.x + zone.width;
        x += latticeSpacing
      ) {
        const center = gridToWorld(this.maze, {
          x,
          z: zone.z + zone.height / 2,
        });
        latticeTransform.compose(
          new THREE.Vector3(center.x, GAME_CONFIG.maze.wallHeight - 0.04, center.z),
          new THREE.Quaternion(),
          new THREE.Vector3(0.04, 0.05, zone.height * cellSize),
        );
        lattice.setMatrixAt(latticeInstance++, latticeTransform);
      }
      for (
        let z = zone.z + oz;
        z <= zone.z + zone.height;
        z += latticeSpacing
      ) {
        const center = gridToWorld(this.maze, {
          x: zone.x + zone.width / 2,
          z,
        });
        latticeTransform.compose(
          new THREE.Vector3(center.x, GAME_CONFIG.maze.wallHeight - 0.04, center.z),
          new THREE.Quaternion(),
          new THREE.Vector3(zone.width * cellSize, 0.05, 0.04),
        );
        lattice.setMatrixAt(latticeInstance++, latticeTransform);
      }
    }
    lattice.count = latticeInstance;
    lattice.computeBoundingBox();
    lattice.computeBoundingSphere();
    this.scene.add(lattice);

    const lightGeometry = new THREE.PlaneGeometry(1.8, 0.35);
    const panels: Array<{ position: THREE.Vector3; rotated: boolean; dimmed: boolean }> = [];
    for (const zone of this.maze.zones) {
      const ox = zoneOffset(zone.id, 7919);
      const oz = zoneOffset(zone.id, 6151);
      let panelIndex = 0;
      for (let z = zone.z + oz + 1; z < zone.z + zone.height; z += 3) {
        for (let x = zone.x + ox + 1; x < zone.x + zone.width; x += 3) {
          const cellX = Math.floor(x);
          const cellZ = Math.floor(z);
          if (!this.maze.cells[cellZ * width + cellX]) {
            panelIndex += 1;
            continue;
          }
          const hash = Math.imul(zone.id + 1, 73856093) ^ Math.imul(panelIndex + 1, 19349663);
          const rotationRoll = (hash >>> 0) / 4294967296;
          const dimRoll = ((Math.imul(hash, 83492791) >>> 0) / 4294967296);
          const position = gridToWorld(this.maze, { x, z });
          panels.push({
            position: new THREE.Vector3(
              position.x,
              GAME_CONFIG.maze.wallHeight - 0.02,
              position.z,
            ),
            rotated: rotationRoll < 0.12,
            dimmed: dimRoll < 0.08,
          });
          panelIndex += 1;
        }
      }
    }
    const addPanels = (dimmed: boolean) => {
      const selected = panels.filter((panel) => panel.dimmed === dimmed);
      const mesh = new THREE.InstancedMesh(
        lightGeometry,
        new THREE.MeshBasicMaterial({
          color: dimmed ? 0x9a9a8e : 0xffffff,
          side: THREE.DoubleSide,
        }),
        selected.length,
      );
      const panelTransform = new THREE.Matrix4();
      const horizontal = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2,
      );
      for (let panelIndex = 0; panelIndex < selected.length; panelIndex += 1) {
        const panel = selected[panelIndex];
        const rotation = new THREE.Quaternion()
          .setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            panel.rotated ? Math.PI / 2 : 0,
          )
          .multiply(horizontal);
        panelTransform.compose(panel.position, rotation, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(panelIndex, panelTransform);
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    };
    addPanels(false);
    addPanels(true);
  }

  private resize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  private updateAdaptiveResolution(now: number): void {
    this.performanceSampleFrames += 1;
    const elapsed = now - this.performanceSampleStarted;
    if (elapsed < 1_000) return;
    const fps = (this.performanceSampleFrames * 1_000) / elapsed;
    const maximumScale = Math.min(window.devicePixelRatio, 1);
    let nextScale = this.renderScale;
    if (fps < 52 && this.renderScale > 0.35) {
      nextScale = Math.max(0.35, this.renderScale - 0.1);
    } else if (fps > 59 && this.renderScale < maximumScale) {
      nextScale = Math.min(maximumScale, this.renderScale + 0.05);
    }
    if (nextScale !== this.renderScale) {
      this.renderScale = nextScale;
      this.renderer.setPixelRatio(this.renderScale);
      this.resize();
    }
    this.canvas.dataset.fps = fps.toFixed(0);
    this.canvas.dataset.renderScale = this.renderScale.toFixed(2);
    this.performanceSampleStarted = now;
    this.performanceSampleFrames = 0;
  }

  private render = (): void => {
    this.raf = requestAnimationFrame(this.render);
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    const smoothing = 1 - Math.exp(-18 * dt);
    if (this.entityCameraEnabled) {
      this.camera.position.lerp(this.entityCameraTarget, smoothing);
      this.camera.lookAt(this.entityLookTarget);
    } else {
      this.camera.position.lerp(this.cameraTarget, smoothing);
      this.camera.rotation.set(this.lookPitch, this.lookYaw + Math.PI, 0);
    }
    for (const [playerId, mesh] of this.playerMeshes) {
      const target = this.playerTargets.get(playerId);
      if (!target) continue;
      mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, target.x, smoothing);
      mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, target.y, smoothing);
    }
    if (this.enemyVisual && this.targetSnapshot) {
      this.targetSnapshot.enemies.forEach((enemy, index) => {
        const target = this.enemyTargets.get(enemy.id);
        const position = this.enemyPositions.get(enemy.id);
        const scaleTarget = this.enemyScaleTargets.get(enemy.id)?.x ?? enemy.scale;
        const scale = THREE.MathUtils.lerp(
          this.enemyScales.get(enemy.id) ?? enemy.scale,
          scaleTarget,
          smoothing,
        );
        if (target && position) position.lerp(target, smoothing);
        this.enemyScales.set(enemy.id, scale);
        this.enemyVisual?.setEnemy(
          index,
          position ?? enemy.position,
          enemy.yaw,
          scale,
          enemy.mode !== "stomped",
        );
      });
    }
    if (
      !this.entityCameraEnabled &&
      this.targetSnapshot?.enemies.some(
        (enemy) => enemy.mode === "chase" || enemy.mode === "attack",
      )
    ) {
      this.camera.position.y += Math.sin(now * 0.018) * 0.006;
    }
    this.renderer.render(this.scene, this.camera);
    this.updateAdaptiveResolution(now);
  };
}
