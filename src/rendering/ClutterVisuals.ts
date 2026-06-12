import * as THREE from "three";
import {
  CLUTTER_ASSET_BY_ID,
  CLUTTER_ASSETS,
  type ClutterAsset,
} from "../assets/clutterManifest";
import { gridToWorld, type ClutterInstance, type Maze } from "../maze/generateMaze";
import { GAME_CONFIG } from "../shared/config";

export interface ClutterVisuals {
  object: THREE.Object3D;
  status: "splat" | "partial" | "fallback";
  dispose(): void;
}

const MAX_TOTAL_SPLATS = 40_000;

function instanceRotation(
  asset: ClutterAsset,
  instance: ClutterInstance,
): THREE.Quaternion {
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    instance.yaw,
  );
  const tiltAxis =
    instance.tiltAxis === 0
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1);
  const tilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, instance.tiltAngle);
  const fix = new THREE.Quaternion(...asset.rotationFix);
  return yaw.multiply(tilt).multiply(fix);
}

function selectedSplatIndexes(clutter: readonly ClutterInstance[]): Set<number> {
  const sceneBudget = Math.floor(
    MAX_TOTAL_SPLATS / GAME_CONFIG.clutter.maxSplatsPerAsset,
  );
  if (clutter.length <= sceneBudget) {
    return new Set(clutter.map((_, index) => index));
  }
  const scored = clutter.map((instance, index) => {
    let neighbors = 0;
    for (const other of clutter) {
      if (Math.hypot(instance.x - other.x, instance.z - other.z) <= 3) neighbors += 1;
    }
    return { index, neighbors };
  });
  scored.sort(
    (left, right) =>
      left.neighbors - right.neighbors ||
      left.index - right.index,
  );
  console.warn(
    `Clutter splat budget exceeded; rendering ${sceneBudget} of ${clutter.length} instances as splats.`,
  );
  return new Set(scored.slice(0, sceneBudget).map(({ index }) => index));
}

function addFallbacks(
  group: THREE.Group,
  maze: Maze,
  indexes: readonly number[],
): { geometries: THREE.BoxGeometry[]; material: THREE.MeshBasicMaterial | null } {
  if (indexes.length === 0) return { geometries: [], material: null };
  const material = new THREE.MeshBasicMaterial({ color: 0x8a8473 });
  const geometries: THREE.BoxGeometry[] = [];
  for (const index of indexes) {
    const instance = maze.clutter[index];
    const asset = CLUTTER_ASSET_BY_ID.get(instance.assetId);
    if (!asset) continue;
    const geometry = new THREE.BoxGeometry(
      asset.footprint.width,
      asset.footprint.height,
      asset.footprint.depth,
    );
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    const position = gridToWorld(maze, instance);
    mesh.position.set(
      position.x,
      instance.y +
        asset.yOffset +
        (asset.footprint.height * instance.scale) / 2,
      position.z,
    );
    mesh.quaternion.copy(instanceRotation(asset, instance));
    mesh.scale.setScalar(instance.scale);
    group.add(mesh);
  }
  return { geometries, material };
}

async function assetExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("text/html")) {
      throw new Error(`Clutter asset ${url} is absent.`);
    }
    return true;
  } catch (error) {
    console.warn(`Clutter splat failed to load for ${url}; using fallback meshes.`, error);
    return false;
  }
}

export async function loadClutterVisuals(maze: Maze): Promise<ClutterVisuals> {
  const group = new THREE.Group();
  if (maze.clutter.length === 0) {
    return { object: group, status: "splat", dispose: () => undefined };
  }

  const selected = selectedSplatIndexes(maze.clutter);
  const availableByUrl = new Map<string, boolean>();
  await Promise.all(
    CLUTTER_ASSETS.map(async (asset) => {
      if (!maze.clutter.some((instance) => instance.assetId === asset.id)) return;
      availableByUrl.set(asset.url, await assetExists(asset.url));
    }),
  );

  const fallbackIndexes: number[] = [];
  const sceneOptions: Array<{
    path: string;
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  }> = [];
  for (let index = 0; index < maze.clutter.length; index += 1) {
    const instance = maze.clutter[index];
    const asset = CLUTTER_ASSET_BY_ID.get(instance.assetId);
    if (!asset || !selected.has(index) || !availableByUrl.get(asset.url)) {
      fallbackIndexes.push(index);
      continue;
    }
    const position = gridToWorld(maze, instance);
    const rotation = instanceRotation(asset, instance);
    const scale = asset.splatScale * instance.scale;
    sceneOptions.push({
      path: asset.url,
      position: [position.x, instance.y + asset.yOffset, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      scale: [scale, scale, scale],
    });
  }

  let viewer: import("@mkkellogg/gaussian-splats-3d").DropInViewer | null = null;
  if (sceneOptions.length > 0) {
    try {
      const splats = await import("@mkkellogg/gaussian-splats-3d");
      viewer = new splats.DropInViewer({
        gpuAcceleratedSort: false,
        sharedMemoryForWorkers: false,
        dynamicScene: false,
      });
      await viewer.addSplatScenes(sceneOptions, false);
      group.add(viewer);
    } catch (error) {
      console.warn("Clutter splat batch failed to load; using fallback meshes.", error);
      viewer?.dispose();
      viewer = null;
      fallbackIndexes.push(
        ...maze.clutter.map((_, index) => index).filter((index) => selected.has(index)),
      );
    }
  }

  const uniqueFallbackIndexes = [...new Set(fallbackIndexes)].sort(
    (left, right) => left - right,
  );
  const fallback = addFallbacks(group, maze, uniqueFallbackIndexes);
  const status =
    viewer && uniqueFallbackIndexes.length === 0
      ? "splat"
      : viewer
        ? "partial"
        : "fallback";
  return {
    object: group,
    status,
    dispose: () => {
      viewer?.dispose();
      fallback.geometries.forEach((geometry) => geometry.dispose());
      fallback.material?.dispose();
    },
  };
}
