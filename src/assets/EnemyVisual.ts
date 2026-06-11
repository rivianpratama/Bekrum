import * as THREE from "three";

export interface EnemyVisual {
  object: THREE.Object3D;
  usedFallback: boolean;
  dispose(): void;
}

function fallbackEnemy(): EnemyVisual {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x090807,
  });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 2), material);
  body.scale.set(0.68, 1.65, 0.58);
  body.position.y = 1.2;
  group.add(body);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b16 });
  for (const x of [-0.22, 0.22]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), eyeMaterial);
    eye.position.set(x, 1.55, 0.55);
    group.add(eye);
  }
  return {
    object: group,
    usedFallback: true,
    dispose: () => {
      body.geometry.dispose();
      material.dispose();
      eyeMaterial.dispose();
    },
  };
}

export async function loadEnemyVisual(url = "/assets/enemy.splat"): Promise<EnemyVisual> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("text/html")) {
      throw new Error("Enemy asset is absent.");
    }
    const splats = await import("@mkkellogg/gaussian-splats-3d");
    const viewer = new splats.DropInViewer({
      gpuAcceleratedSort: true,
      sharedMemoryForWorkers: false,
    });
    await viewer.addSplatScene(url, {
      showLoadingUI: false,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    return {
      object: viewer,
      usedFallback: false,
      dispose: () => viewer.dispose(),
    };
  } catch {
    return fallbackEnemy();
  }
}
