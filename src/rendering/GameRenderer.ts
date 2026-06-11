import * as THREE from "three";
import { loadEnemyVisual, type EnemyVisual } from "../assets/EnemyVisual";
import { cellToWorld, type Maze } from "../maze/generateMaze";
import { GAME_CONFIG } from "../shared/config";
import type { GameSnapshot } from "../shared/types";

export class GameRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 80);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly playerMeshes = new Map<string, THREE.Mesh>();
  private readonly playerTargets = new Map<string, THREE.Vector2>();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly enemyTarget = new THREE.Vector3();
  private readonly enemyScaleTarget = new THREE.Vector3(1, 1, 1);
  private enemyVisual: EnemyVisual | null = null;
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
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color(0x817b55);
    this.scene.fog = new THREE.Fog(0xb5ad7a, 34, 72);
    this.camera.rotation.order = "YXZ";
    this.buildMaze();
    void this.attachEnemy();
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
    if (this.enemyVisual) {
      const object = this.enemyVisual.object;
      object.rotation.y = snapshot.enemy.yaw;
      const scale = snapshot.enemy.scale;
      this.enemyTarget.set(snapshot.enemy.position.x, 0, snapshot.enemy.position.z);
      this.enemyScaleTarget.set(scale, scale, scale);
      object.visible = snapshot.enemy.mode !== "stomped";
    }
  }

  setLook(yaw: number, pitch: number): void {
    this.lookYaw = yaw;
    this.lookPitch = pitch;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.enemyVisual?.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
  }

  private async attachEnemy(): Promise<void> {
    this.enemyVisual = await loadEnemyVisual();
    if (this.targetSnapshot) {
      const enemy = this.targetSnapshot.enemy;
      this.enemyTarget.set(enemy.position.x, 0, enemy.position.z);
      this.enemyVisual.object.position.copy(this.enemyTarget);
      this.enemyScaleTarget.setScalar(enemy.scale);
      this.enemyVisual.object.scale.copy(this.enemyScaleTarget);
    }
    this.scene.add(this.enemyVisual.object);
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

  private createCarpetTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is required for carpet texture.");
    context.fillStyle = "#756747";
    context.fillRect(0, 0, 128, 128);
    for (let index = 0; index < 650; index += 1) {
      const x = (index * 43) % 128;
      const y = (index * 79) % 128;
      const shade = 48 + ((index * 17) % 45);
      context.fillStyle = `rgba(${shade}, ${shade - 6}, ${Math.max(20, shade - 20)}, 0.22)`;
      context.fillRect(x, y, 1 + (index % 2), 1);
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
    const wallTexture = loader.load("/assets/backrooms-atlas.png");
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(0.5, 1);
    const carpetTexture = this.createCarpetTexture();
    carpetTexture.repeat.set(width, height);

    const wallGeometry = new THREE.BoxGeometry(cellSize, GAME_CONFIG.maze.wallHeight, cellSize);
    wallTexture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const wallMaterial = new THREE.MeshBasicMaterial({ map: wallTexture, color: 0xf4e994 });
    const wallCount = [...this.maze.cells].filter((cell) => cell === 0).length;
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCount);
    const transform = new THREE.Matrix4();
    let instance = 0;
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        if (this.maze.cells[z * width + x]) continue;
        const position = cellToWorld(this.maze, { x, z });
        transform.makeTranslation(position.x, GAME_CONFIG.maze.wallHeight / 2, position.z);
        walls.setMatrixAt(instance++, transform);
      }
    }
    this.scene.add(walls);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width * cellSize, height * cellSize),
      new THREE.MeshBasicMaterial({ map: carpetTexture, color: 0xb9a77a }),
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

    const lightGeometry = new THREE.PlaneGeometry(1.8, 0.35);
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const lightPositions: THREE.Vector3[] = [];
    for (let z = 1; z < height - 1; z += 4) {
      for (let x = 1; x < width - 1; x += 4) {
        if (!this.maze.cells[z * width + x]) continue;
        const position = cellToWorld(this.maze, { x, z });
        lightPositions.push(
          new THREE.Vector3(position.x, GAME_CONFIG.maze.wallHeight - 0.02, position.z),
        );
      }
    }
    const panels = new THREE.InstancedMesh(lightGeometry, lightMaterial, lightPositions.length);
    const panelTransform = new THREE.Matrix4();
    const panelRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    for (let index = 0; index < lightPositions.length; index += 1) {
      panelTransform.compose(lightPositions[index], panelRotation, new THREE.Vector3(1, 1, 1));
      panels.setMatrixAt(index, panelTransform);
    }
    this.scene.add(panels);
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
    this.camera.position.lerp(this.cameraTarget, smoothing);
    this.camera.rotation.set(this.lookPitch, this.lookYaw + Math.PI, 0);
    for (const [playerId, mesh] of this.playerMeshes) {
      const target = this.playerTargets.get(playerId);
      if (!target) continue;
      mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, target.x, smoothing);
      mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, target.y, smoothing);
    }
    if (this.enemyVisual) {
      this.enemyVisual.object.position.lerp(this.enemyTarget, smoothing);
      this.enemyVisual.object.scale.lerp(this.enemyScaleTarget, smoothing);
    }
    if (this.targetSnapshot?.enemy.mode === "chase") {
      this.camera.position.y += Math.sin(now * 0.018) * 0.006;
    }
    this.renderer.render(this.scene, this.camera);
    this.updateAdaptiveResolution(now);
  };
}
