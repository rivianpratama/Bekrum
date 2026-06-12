/// <reference types="vite/client" />

declare module "@mkkellogg/gaussian-splats-3d" {
  import type { Object3D } from "three";

  export class SplatBuffer {}

  export const SceneFormat: {
    Splat: 0;
    KSplat: 1;
    Ply: 2;
    Spz: 3;
  };

  export interface SplatBufferOptions {
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
  }

  export class Viewer {
    downloadSplatSceneToSplatBuffer(
      path: string,
      splatAlphaRemovalThreshold?: number,
      onProgress?: ((percent: number) => void) | undefined,
      progressiveBuild?: boolean,
      onSectionBuilt?: (() => void) | undefined,
      format?: number,
    ): Promise<SplatBuffer>;
    addSplatBuffers(
      splatBuffers: SplatBuffer[],
      options?: SplatBufferOptions[],
      finalBuild?: boolean,
      showLoadingUI?: boolean,
      showLoadingUIForSplatTreeBuild?: boolean,
      replaceExisting?: boolean,
      enableRenderBeforeFirstSort?: boolean,
    ): Promise<void>;
  }

  export class DropInViewer extends Object3D {
    viewer: Viewer;
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
