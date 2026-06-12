import * as THREE from "three";

export interface PlayerVisual {
  object: THREE.Object3D;
  usedFallback: boolean;
  setPlayer(
    index: number,
    position: { x: number; z: number },
    yaw: number,
    visible: boolean,
  ): void;
  dispose(): void;
}

function createPlayerFallbackVisual(count: number): PlayerVisual {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xa5ab82,
  });
  const bodyGeometry = new THREE.CapsuleGeometry(0.34, 1.05, 4, 8);
  const players: THREE.Mesh[] = [];
  for (let index = 0; index < count; index += 1) {
    const mesh = new THREE.Mesh(bodyGeometry, material);
    mesh.position.y = 1;
    players.push(mesh);
    group.add(mesh);
  }
  return {
    object: group,
    usedFallback: true,
    setPlayer: (index, position, yaw, visible) => {
      const player = players[index];
      if (!player) return;
      player.position.set(position.x, 1, position.z);
      player.rotation.y = yaw;
      player.visible = visible;
    },
    dispose: () => {
      bodyGeometry.dispose();
      material.dispose();
    },
  };
}

export async function loadPlayerVisual(
  count = 1,
  url = "/assets/player.splat",
): Promise<PlayerVisual> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Player asset request failed with ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const splats = await import("@mkkellogg/gaussian-splats-3d");
    const viewer = new splats.DropInViewer({
      gpuAcceleratedSort: false,
      sharedMemoryForWorkers: false,
      dynamicScene: true,
    });
    const root = new THREE.Group();
    const players: THREE.Object3D[] = [viewer];
    root.add(viewer);
    // Use the same orientation as the enemy splat
    await viewer.addSplatScene(url, {
      showLoadingUI: false,
      position: [0, 1.2, 0],
      rotation: [Math.SQRT1_2, 0, Math.SQRT1_2, 0],
      scale: [3, 3, 3],
    });
    let pointGeometry: THREE.BufferGeometry | null = null;
    let pointMaterial: THREE.PointsMaterial | null = null;
    if (count > 1) {
      const rowSize = 32;
      const stride = 2;
      const pointCount = Math.floor(bytes.length / rowSize / stride);
      const positions = new Float32Array(pointCount * 3);
      const colors = new Float32Array(pointCount * 3);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let point = 0; point < pointCount; point += 1) {
        const base = point * stride * rowSize;
        positions[point * 3] = view.getFloat32(base, true);
        positions[point * 3 + 1] = view.getFloat32(base + 4, true);
        positions[point * 3 + 2] = view.getFloat32(base + 8, true);
        colors[point * 3] = bytes[base + 24] / 255;
        colors[point * 3 + 1] = bytes[base + 25] / 255;
        colors[point * 3 + 2] = bytes[base + 26] / 255;
      }
      pointGeometry = new THREE.BufferGeometry();
      pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      pointGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      pointGeometry.computeBoundingSphere();
      pointMaterial = new THREE.PointsMaterial({
        size: 0.035,
        sizeAttenuation: true,
        vertexColors: true,
      });
      const baseRotation = new THREE.Quaternion(Math.SQRT1_2, 0, Math.SQRT1_2, 0);
      for (let index = 1; index < count; index += 1) {
        const player = new THREE.Group();
        const points = new THREE.Points(pointGeometry, pointMaterial);
        points.position.y = 1.2;
        points.quaternion.copy(baseRotation);
        points.scale.setScalar(3);
        player.add(points);
        players.push(player);
        root.add(player);
      }
    }
    return {
      object: root,
      usedFallback: false,
      setPlayer: (index, position, yaw, visible) => {
        const player = players[index];
        if (!player) return;
        player.position.set(position.x, 0, position.z);
        player.rotation.y = yaw;
        player.visible = visible;
      },
      dispose: () => {
        viewer.dispose();
        pointGeometry?.dispose();
        pointMaterial?.dispose();
      },
    };
  } catch (error) {
    console.warn("Player splat failed to load; using fallback mesh.", error);
    return createPlayerFallbackVisual(count);
  }
}
