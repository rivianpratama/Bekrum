/// <reference types="vite/client" />

declare module "@mkkellogg/gaussian-splats-3d" {
  import type { Object3D } from "three";

  export class DropInViewer extends Object3D {
    constructor(options?: {
      gpuAcceleratedSort?: boolean;
      sharedMemoryForWorkers?: boolean;
      dynamicScene?: boolean;
    });
    addSplatScene(
      url: string,
      options?: {
        showLoadingUI?: boolean;
        position?: [number, number, number];
        rotation?: [number, number, number, number];
        scale?: [number, number, number];
      },
    ): Promise<void>;
    addSplatScenes(
      scenes: Array<{
        path: string;
        position?: [number, number, number];
        rotation?: [number, number, number, number];
        scale?: [number, number, number];
      }>,
      showLoadingUI?: boolean,
    ): Promise<void>;
    dispose(): void;
  }
}
