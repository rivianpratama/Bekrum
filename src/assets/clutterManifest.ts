export interface ClutterAsset {
  id: string;
  url: string;
  footprint: { width: number; depth: number; height: number };
  blocksSight: boolean;
  stackable: boolean;
  base: boolean;
  yOffset: number;
  splatScale: number;
  rotationFix: [number, number, number, number];
}

const IDENTITY_ROTATION: [number, number, number, number] = [0, 0, 0, 1];

export const CLUTTER_ASSETS: readonly ClutterAsset[] = [
  {
    id: "bed",
    url: "/assets/clutter/bed.splat",
    footprint: { width: 2, depth: 1, height: 0.6 },
    blocksSight: false,
    stackable: false,
    base: true,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "cabinet",
    url: "/assets/clutter/cabinet.splat",
    footprint: { width: 0.9, depth: 0.45, height: 1.8 },
    blocksSight: true,
    stackable: false,
    base: true,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "christmas",
    url: "/assets/clutter/christmas.splat",
    footprint: { width: 1.2, depth: 1.2, height: 2.2 },
    blocksSight: true,
    stackable: false,
    base: false,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "chair-odd",
    url: "/assets/clutter/chair-odd.splat",
    footprint: { width: 0.65, depth: 0.65, height: 1 },
    blocksSight: false,
    stackable: true,
    base: false,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "desk",
    url: "/assets/clutter/desk.splat",
    footprint: { width: 1.4, depth: 0.7, height: 0.75 },
    blocksSight: false,
    stackable: false,
    base: true,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "king",
    url: "/assets/clutter/king.splat",
    footprint: { width: 0.9, depth: 0.9, height: 1.7 },
    blocksSight: true,
    stackable: false,
    base: false,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "lamp",
    url: "/assets/clutter/lamp.splat",
    footprint: { width: 0.4, depth: 0.4, height: 1.5 },
    blocksSight: true,
    stackable: true,
    base: false,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "office",
    url: "/assets/clutter/office.splat",
    footprint: { width: 0.75, depth: 0.75, height: 1.1 },
    blocksSight: false,
    stackable: true,
    base: false,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "sofa",
    url: "/assets/clutter/sofa.splat",
    footprint: { width: 1.9, depth: 0.9, height: 0.8 },
    blocksSight: false,
    stackable: false,
    base: true,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
  {
    id: "mass",
    url: "/assets/clutter/mass.splat",
    footprint: { width: 1.5, depth: 1.4, height: 1.8 },
    blocksSight: true,
    stackable: false,
    base: true,
    yOffset: 0,
    splatScale: 1,
    rotationFix: IDENTITY_ROTATION,
  },
] as const;

export const CLUTTER_ASSET_BY_ID = new Map(
  CLUTTER_ASSETS.map((asset) => [asset.id, asset] as const),
);
