import * as THREE from "three";

export interface EnemyVisual {
  object: THREE.Object3D;
  usedFallback: boolean;
  setEnemy(
    index: number,
    position: { x: number; z: number },
    yaw: number,
    scale: number,
    visible: boolean,
  ): void;
  dispose(): void;
}

function createEnemyFallbackVisual(count: number): EnemyVisual {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x090807,
  });
  const bodyGeometry = new THREE.IcosahedronGeometry(0.95, 2);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b16 });
  const eyeGeometry = new THREE.SphereGeometry(0.055, 10, 10);
  const enemies: THREE.Group[] = [];
  for (let index = 0; index < count; index += 1) {
    const enemy = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, material);
    body.scale.set(0.68, 1.65, 0.58);
    body.position.y = 1.2;
    enemy.add(body);
    for (const x of [-0.22, 0.22]) {
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eye.position.set(x, 1.55, 0.55);
      enemy.add(eye);
    }
    enemies.push(enemy);
    group.add(enemy);
  }
  return {
    object: group,
    usedFallback: true,
    setEnemy: (index, position, yaw, scale, visible) => {
      const enemy = enemies[index];
      if (!enemy) return;
      enemy.position.set(position.x, 0, position.z);
      enemy.rotation.y = yaw;
      enemy.scale.setScalar(scale);
      enemy.visible = visible;
    },
    dispose: () => {
      bodyGeometry.dispose();
      eyeGeometry.dispose();
      material.dispose();
      eyeMaterial.dispose();
    },
  };
}

export async function loadEnemyVisual(
  count = 1,
  url = "/assets/enemy.splat",
): Promise<EnemyVisual> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Enemy asset request failed with ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const splats = await import("@mkkellogg/gaussian-splats-3d");
    const viewer = new splats.DropInViewer({
      gpuAcceleratedSort: false,
      sharedMemoryForWorkers: false,
      dynamicScene: true,
    });
    const root = new THREE.Group();
    const enemies: THREE.Object3D[] = [viewer];
    root.add(viewer);
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
        const enemy = new THREE.Group();
        const points = new THREE.Points(pointGeometry, pointMaterial);
        points.position.y = 1.2;
        points.quaternion.copy(baseRotation);
        points.scale.setScalar(3);
        enemy.add(points);
        enemies.push(enemy);
        root.add(enemy);
      }
    }
    return {
      object: root,
      usedFallback: false,
      setEnemy: (index, position, yaw, scale, visible) => {
        const enemy = enemies[index];
        if (!enemy) return;
        enemy.position.set(position.x, 0, position.z);
        enemy.rotation.y = yaw;
        enemy.scale.setScalar(scale);
        enemy.visible = visible;
      },
      dispose: () => {
        viewer.dispose();
        pointGeometry?.dispose();
        pointMaterial?.dispose();
      },
    };
  } catch (error) {
    console.warn("Enemy splat failed to load; using fallback mesh.", error);
    return createEnemyFallbackVisual(count);
  }
}
