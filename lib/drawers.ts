// Drawer-cabinet geometry for the Drawers → 3D tool.
//
// A freestanding chest of drawers: an open-front cabinet divided by (N − 1)
// shelves into N compartments, plus N drawer trays that slide into those
// compartments. The drawers are printed beside the cabinet.
//
// The cabinet's outer form is a rectangular box with a straight 45° CHAMFER
// (`chamferMm`) on ALL twelve outer edges — the 4 vertical corners, the 4 top
// edges and the 4 bottom edges. A heightfield cannot slope an outer face (its
// side walls are always vertical) and can only staircase a corner, so the
// cabinet is built as ONE explicit, closed polyhedron: the 6 shrunken face
// rectangles, the 12 edge-chamfer rectangles and the 8 corner triangles, with
// the front cavity cut as a rectangular pocket (the front face becomes a ring,
// triangulated with earcut).
//
//   cabinet = chamfered box − front pocket         drawer (side view)
//        ╱────────────╲                            ┌───────────┐ ← front panel
//       ╱  ┌────────┐  ╲  ← opening                │ ┌───────┐ │
//      │   │ cavity │   │                           │ │ tray  │ │
//      │   └────────┘   │                           │ └───────┘ │
//      ╲________________╱                            └───────────┘
//
// Each drawer front panel is an explicit prism whose two front vertical corners
// are cut by the same chamfer, and it is built FULL WIDTH so when the drawers
// are closed their edges continue the cube's front vertical chamfers. The tray
// is an explicit open-top box (few triangles; exact, not grid-snapped).

import earcut from "earcut";
import { modelBounds } from "./bounds";
import type { RGB } from "./quantize";

export interface DrawersInput {
  /** Cabinet outer width, X (mm). */
  cabinetWidthMm: number;
  /** Cabinet outer depth, front-to-back, Y (mm). */
  cabinetDepthMm: number;
  /** Cabinet outer height, Z (mm). */
  cabinetHeightMm: number;
  /** Perimeter wall thickness (mm). */
  wallMm: number;
  /** Cabinet floor thickness (mm). */
  floorMm: number;
  /** Cabinet roof (top) thickness (mm). */
  roofMm: number;
  /** Shelf / divider thickness between compartments (mm). */
  shelfMm: number;
  /** Number of drawers / compartments. */
  drawerCount: number;
  /** Drawer tray wall thickness (mm). */
  trayWallMm: number;
  /** Drawer tray floor thickness (mm). */
  trayFloorMm: number;
  /** Drawer front panel thickness (mm). */
  frontMm: number;
  /** Drawer-to-opening fit clearance, per enclosed side (mm). */
  fitClearanceMm: number;
  /** Vertical play between a drawer and its compartment (mm). */
  gapMm: number;
  /** Straight 45° chamfer on the cube's 12 outer edges + the drawer fronts
   *  (mm; 0 = square). Clamped so it never eats the walls / front strips. */
  chamferMm: number;
  /** Grid resolution: cells across the larger footprint side. */
  resolution: number;
  /** Cabinet colour. */
  color: RGB;
  /** Drawer colour. */
  drawerColor: RGB;
}

export interface DrawersPart {
  name: string;
  color: RGB;
  positions: number[];
}

export interface DrawersResult {
  parts: DrawersPart[];
  gw: number;
  gh: number;
  pixelSizeMm: number;
  /** Cabinet outer width (mm). */
  widthMm: number;
  /** Cabinet outer depth (mm). */
  heightMm: number;
  /** Cabinet outer height (mm). */
  depthMm: number;
  drawerCount: number;
  /** Interior height of one compartment (mm). */
  compartmentHeightMm: number;
  /** The chamfer actually used (mm), after clamping. */
  chamferMm: number;
  triangleCount: number;
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  /** RGBA top-down footprint of the cabinet for the 2D preview. */
  preview: Uint8ClampedArray;
  /** Cabinet solid height (mm) at a cabinet-local point (x right, y up). */
  heightAt(xMm: number, yMm: number): number;
  warnings: string[];
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Gap left between the cabinet and each drawer in the printed layout (mm). */
const LAYOUT_GAP = 6;

type V3 = [number, number, number];

/**
 * Append a polygon (≥3 points) to a triangle soup, fan-triangulated. The vertex
 * order is chosen automatically so the face normal points AWAY from `C` (a
 * point inside the solid) — this keeps a hand-built solid outward-wound without
 * hand-checking every face. Degenerate (zero-area) triangles are skipped.
 */
function pushOriented(out: number[], pts: V3[], C: V3): void {
  const n = pts.length;
  if (n < 3) return;
  const [ax, ay, az] = pts[0];
  const [bx, by, bz] = pts[1];
  const [cx, cy, cz] = pts[2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx === 0 && ny === 0 && nz === 0) return; // degenerate polygon
  let fx = 0, fy = 0, fz = 0;
  for (const p of pts) {
    fx += p[0]; fy += p[1]; fz += p[2];
  }
  fx /= n; fy /= n; fz /= n;
  const dot = nx * (fx - C[0]) + ny * (fy - C[1]) + nz * (fz - C[2]);
  const P = dot < 0 ? [pts[0], ...pts.slice(1).reverse()] : pts;
  for (let i = 1; i < n - 1; i++) {
    const a = P[0], b = P[i], d = P[i + 1];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
    const cX = e1y * e2z - e1z * e2y;
    const cY = e1z * e2x - e1x * e2z;
    const cZ = e1x * e2y - e1y * e2x;
    if (Math.abs(cX) + Math.abs(cY) + Math.abs(cZ) < 1e-9) continue;
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
  }
}

/**
 * Triangulate a planar polygon with a rectangular hole (the cabinet's front
 * face) at height `y`. Coordinates are given in the plane's (x, z); each output
 * triangle's winding is fixed by `pushOriented`.
 */
function pushRing(
  out: number[],
  outer: [number, number][],
  hole: [number, number][],
  y: number,
  dir: V3
): void {
  const flat: number[] = [];
  for (const p of outer) flat.push(p[0], p[1]);
  const holeStart = flat.length / 2;
  for (const p of hole) flat.push(p[0], p[1]);
  const tris = earcut(flat, [holeStart], 2);
  for (let i = 0; i < tris.length; i += 3) {
    const t: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = tris[i + k] * 2;
      t.push([flat[j], y, flat[j + 1]]);
    }
    pushFace(out, t, dir);
  }
}

/**
 * Like `pushRing`, but for a plane of constant Z (the tray's top rim): the 2D
 * coordinates are (x, y) and the polygon is placed at height `z`.
 */
function pushRingZ(
  out: number[],
  outer: [number, number][],
  hole: [number, number][],
  z: number,
  dir: V3
): void {
  const flat: number[] = [];
  for (const p of outer) flat.push(p[0], p[1]);
  const holeStart = flat.length / 2;
  for (const p of hole) flat.push(p[0], p[1]);
  const tris = earcut(flat, [holeStart], 2);
  for (let i = 0; i < tris.length; i += 3) {
    const t: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = tris[i + k] * 2;
      t.push([flat[j], flat[j + 1], z]);
    }
    pushFace(out, t, dir);
  }
}

/**
 * Append a polygon oriented so its normal points along `dir` (its outward
 * direction). Used where the solid's centroid is not on the material side of
 * the face — cavity / pocket walls, and the drawer tray's inner faces.
 */
function pushFace(out: number[], pts: V3[], dir: V3): void {
  const n = pts.length;
  if (n < 3) return;
  const [ax, ay, az] = pts[0];
  const [bx, by, bz] = pts[1];
  const [cx, cy, cz] = pts[2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx === 0 && ny === 0 && nz === 0) return; // degenerate polygon
  const dot = nx * dir[0] + ny * dir[1] + nz * dir[2];
  const P = dot < 0 ? [pts[0], ...pts.slice(1).reverse()] : pts;
  for (let i = 1; i < n - 1; i++) {
    const a = P[0], b = P[i], d = P[i + 1];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
    const cX = e1y * e2z - e1z * e2y;
    const cY = e1z * e2x - e1x * e2z;
    const cZ = e1x * e2y - e1y * e2x;
    if (Math.abs(cX) + Math.abs(cY) + Math.abs(cZ) < 1e-9) continue;
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
  }
}


/**
 * Append a closed, outward-wound box to a triangle soup (shelves).
 */
function pushBox(
  out: number[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number
): void {
  const q = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number
  ) => {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    out.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
  };
  q(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0); // bottom −Z
  q(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1); // top +Z
  q(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1); // front −Y
  q(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0); // back +Y
  q(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0); // left −X
  q(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1); // right +X
}

/**
 * The cabinet: a rectangular box with a 45° chamfer `c` on all 12 outer edges,
 * minus a rectangular pocket open at the front (the drawer cavity). Returns one
 * closed, manifold triangle soup. The pocket is [px0,px1] × [0,py1] × [pz0,pz1];
 * the caller guarantees c < wall/floor/roof so the pocket stays clear of the
 * chamfers and the front face keeps a rim.
 */
function buildChamferedCabinet(
  W: number, D: number, H: number, c: number,
  px0: number, px1: number, py1: number, pz0: number, pz1: number
): number[] {
  const out: number[] = [];
  const C: V3 = [W / 2, D / 2, H / 2];

  // 6 face rectangles (the front face is the ring, below)
  pushOriented(out, [[c, c, 0], [W - c, c, 0], [W - c, D - c, 0], [c, D - c, 0]], C); // z=0
  pushOriented(out, [[c, c, H], [c, D - c, H], [W - c, D - c, H], [W - c, c, H]], C); // z=H
  pushOriented(out, [[0, c, c], [0, D - c, c], [0, D - c, H - c], [0, c, H - c]], C); // x=0
  pushOriented(out, [[W, c, c], [W, c, H - c], [W, D - c, H - c], [W, D - c, c]], C); // x=W
  pushOriented(out, [[c, D, c], [c, D, H - c], [W - c, D, H - c], [W - c, D, c]], C); // y=D

  // 4 vertical-edge chamfers (span z from c to H−c)
  pushOriented(out, [[0, c, c], [c, 0, c], [c, 0, H - c], [0, c, H - c]], C);         // x+y=c
  pushOriented(out, [[0, D - c, c], [0, D - c, H - c], [c, D, H - c], [c, D, c]], C); // x+(D−y)=c
  pushOriented(out, [[W, c, c], [W, c, H - c], [W - c, 0, H - c], [W - c, 0, c]], C); // (W−x)+y=c
  pushOriented(out, [[W, D - c, c], [W - c, D, c], [W - c, D, H - c], [W, D - c, H - c]], C); // (W−x)+(D−y)=c

  // 4 X-parallel edge chamfers (span x from c to W−c)
  pushOriented(out, [[c, 0, c], [W - c, 0, c], [W - c, c, 0], [c, c, 0]], C);         // y+z=c  (front-bottom)
  pushOriented(out, [[c, 0, H - c], [c, c, H], [W - c, c, H], [W - c, 0, H - c]], C); // y+(H−z)=c (front-top)
  pushOriented(out, [[c, D - c, 0], [W - c, D - c, 0], [W - c, D, c], [c, D, c]], C); // (D−y)+z=c (back-bottom)
  pushOriented(out, [[c, D, H - c], [W - c, D, H - c], [W - c, D - c, H], [c, D - c, H]], C); // (D−y)+(H−z)=c

  // 4 Y-parallel edge chamfers (span y from c to D−c)
  pushOriented(out, [[0, c, c], [0, D - c, c], [c, D - c, 0], [c, c, 0]], C);         // x+z=c (left-bottom)
  pushOriented(out, [[0, c, H - c], [c, c, H], [c, D - c, H], [0, D - c, H - c]], C); // x+(H−z)=c (left-top)
  pushOriented(out, [[W, c, c], [W - c, c, 0], [W - c, D - c, 0], [W, D - c, c]], C); // (W−x)+z=c (right-bottom)
  pushOriented(out, [[W, c, H - c], [W, D - c, H - c], [W - c, D - c, H], [W - c, c, H]], C); // (W−x)+(H−z)=c

  // 8 corner triangles (one per cube vertex)
  for (const cx of [0, W]) {
    for (const cy of [0, D]) {
      for (const cz of [0, H]) {
        const ix = cx === 0 ? 1 : -1;
        const iy = cy === 0 ? 1 : -1;
        const iz = cz === 0 ? 1 : -1;
        pushOriented(out, [
          [cx, cy + iy * c, cz + iz * c],
          [cx + ix * c, cy, cz + iz * c],
          [cx + ix * c, cy + iy * c, cz],
        ], C);
      }
    }
  }

  // front face (y=0): outer rectangle with the pocket mouth as a hole
  pushRing(
    out,
    [[c, c], [W - c, c], [W - c, H - c], [c, H - c]],
    [[px0, pz0], [px0, pz1], [px1, pz1], [px1, pz0]],
    0,
    [0, -1, 0]
  );

  // pocket walls (explicit outward normals: they point into the cavity)
  pushFace(out, [[px0, 0, pz0], [px0, 0, pz1], [px0, py1, pz1], [px0, py1, pz0]], [1, 0, 0]); // left
  pushFace(out, [[px1, 0, pz0], [px1, py1, pz0], [px1, py1, pz1], [px1, 0, pz1]], [-1, 0, 0]); // right
  pushFace(out, [[px0, py1, pz0], [px0, py1, pz1], [px1, py1, pz1], [px1, py1, pz0]], [0, -1, 0]); // back
  pushFace(out, [[px0, 0, pz0], [px1, 0, pz0], [px1, py1, pz0], [px0, py1, pz0]], [0, 0, 1]); // floor
  pushFace(out, [[px0, 0, pz1], [px0, py1, pz1], [px1, py1, pz1], [px1, 0, pz1]], [0, 0, -1]); // ceiling

  return out;
}

/**
 * A drawer front panel: a rectangular prism (X 0..W, Y 0..depth, Z 0..height)
 * with its two front vertical corners cut by `c` — so when the drawer is closed
 * it continues the cube's front vertical chamfers.
 */
function buildDrawerPanel(W: number, depth: number, height: number, c: number): number[] {
  const out: number[] = [];
  const C: V3 = [W / 2, depth / 2, height / 2];
  const sec: [number, number][] = [
    [0, c], [0, depth], [W, depth], [W, c], [W - c, 0], [c, 0],
  ];
  pushOriented(out, sec.map(([x, y]) => [x, y, 0] as V3), C);
  pushOriented(out, sec.map(([x, y]) => [x, y, height] as V3), C);
  for (let i = 0; i < sec.length; i++) {
    const a = sec[i];
    const b = sec[(i + 1) % sec.length];
    pushOriented(out, [
      [a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], height], [a[0], a[1], height],
    ], C);
  }
  return out;
}

/**
 * A drawer tray: an open-top box (floor + 4 walls) with an exact footprint.
 * Explicit so it stays small (a heightfield would emit per-cell quads) — the
 * inner faces carry explicit inward normals via pushFace.
 */
function buildTray(W: number, D: number, H: number, wall: number, floor: number): number[] {
  const out: number[] = [];
  const ix0 = wall, ix1 = W - wall, iy0 = wall, iy1 = D - wall, iz0 = floor;
  pushFace(out, [[0, 0, 0], [0, D, 0], [W, D, 0], [W, 0, 0]], [0, 0, -1]); // bottom
  pushFace(out, [[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]], [0, -1, 0]); // front
  pushFace(out, [[0, D, 0], [0, D, H], [W, D, H], [W, D, 0]], [0, 1, 0]); // back
  pushFace(out, [[0, 0, 0], [0, 0, H], [0, D, H], [0, D, 0]], [-1, 0, 0]); // left
  pushFace(out, [[W, 0, 0], [W, D, 0], [W, D, H], [W, 0, H]], [1, 0, 0]); // right
  // top rim: outer rectangle minus the cavity
  pushRingZ(out, [[0, 0], [W, 0], [W, D], [0, D]], [[ix0, iy0], [ix0, iy1], [ix1, iy1], [ix1, iy0]], H, [0, 0, 1]);
  // inner walls (normals point into the cavity)
  pushFace(out, [[ix0, iy0, iz0], [ix0, iy0, H], [ix0, iy1, H], [ix0, iy1, iz0]], [1, 0, 0]); // inner left
  pushFace(out, [[ix1, iy0, iz0], [ix1, iy1, iz0], [ix1, iy1, H], [ix1, iy0, H]], [-1, 0, 0]); // inner right
  pushFace(out, [[ix0, iy0, iz0], [ix1, iy0, iz0], [ix1, iy0, H], [ix0, iy0, H]], [0, 1, 0]); // inner front
  pushFace(out, [[ix0, iy1, iz0], [ix0, iy1, H], [ix1, iy1, H], [ix1, iy1, iz0]], [0, -1, 0]); // inner back
  pushFace(out, [[ix0, iy0, iz0], [ix1, iy0, iz0], [ix1, iy1, iz0], [ix0, iy1, iz0]], [0, 0, 1]); // inner floor
  return out;
}


/** Inside the cabinet's chamfered footprint (rectangle with corners cut by c). */
function insideOct(x: number, y: number, W: number, D: number, c: number): boolean {
  if (x < 0 || x > W || y < 0 || y > D) return false;
  if (c > 0) {
    if (x + y < c) return false;
    if (W - x + y < c) return false;
    if (x + (D - y) < c) return false;
    if (W - x + (D - y) < c) return false;
  }
  return true;
}

/**
 * Build a chamfered open-front drawer cabinet plus N full-width drawer fronts
 * with matching chamfers (pure). Returns the parts, a 2D footprint preview and
 * a top height query.
 */
export function buildDrawers(input: DrawersInput): DrawersResult {
  const warnings: string[] = [];

  const W = Math.max(20, input.cabinetWidthMm);
  const D = Math.max(20, input.cabinetDepthMm);
  const H = Math.max(10, input.cabinetHeightMm);
  const wall = Math.max(0.6, input.wallMm);
  const floorThk = Math.max(0.4, input.floorMm);
  const roofThk = Math.max(0.4, input.roofMm);
  const shelfThk = Math.max(0.4, input.shelfMm);
  const N = clamp(Math.round(input.drawerCount), 1, 12);
  const trayWall = Math.max(0.6, input.trayWallMm);
  const trayFloor = Math.max(0.4, input.trayFloorMm);
  const frontThk = Math.max(0.8, input.frontMm);
  const fit = Math.max(0.05, input.fitClearanceMm);
  const gap = Math.max(0, input.gapMm);
  const res = clamp(Math.round(input.resolution), 80, 600);

  // Chamfer must stay clear of the front strips and the corner walls, so it is
  // limited by the thinnest of the wall / floor / roof / front panel.
  const cLimit = Math.max(0, Math.min(wall, floorThk, roofThk, frontThk) - 0.4);
  const cHard = Math.min(cLimit, Math.min(W, D, H) / 2 - 0.5);
  const c = clamp(input.chamferMm, 0, Math.max(0, cHard));
  if (input.chamferMm > c + 1e-6) {
    warnings.push(
      `Chamfer ${input.chamferMm.toFixed(1)} mm is larger than the walls, floor, ` +
        `roof or front panel allow — clamped to ${c.toFixed(1)} mm (thicken them ` +
        `to chamfer more).`
    );
  }

  // grid — used only for the tray heightfields, the 2D preview and heightAt
  const pixelSize = Math.max(W, D) / res;
  const gw = Math.max(3, Math.round(W / pixelSize));
  const gh = Math.max(3, Math.round(D / pixelSize));
  const n = gw * gh;

  const px0 = wall;
  const px1 = W - wall;
  const py1 = D - wall;
  const pz0 = floorThk;
  const pz1 = H - roofThk;

  // ---- cabinet: one explicit chamfered solid with a front pocket ----
  const cabinetPositions = buildChamferedCabinet(W, D, H, c, px0, px1, py1, pz0, pz1);

  const parts: DrawersPart[] = [
    { name: "Cabinet", color: input.color, positions: cabinetPositions },
  ];

  // ---- shelves: exact boxes (disjoint -> one watertight part) ----
  const interiorH = Math.max(N + 1, pz1 - pz0 - (N - 1) * shelfThk);
  const ch = interiorH / N;
  const frontH = Math.max(trayFloor + 1, ch - gap);
  if (N > 1) {
    const overlap = Math.min(wall, 0.6);
    const shelfSoup: number[] = [];
    for (let k = 0; k < N - 1; k++) {
      const z0 = pz0 + k * (ch + shelfThk) + ch;
      pushBox(shelfSoup, px0 - overlap, px1 + overlap, 0, py1 + overlap, z0, z0 + shelfThk);
    }
    parts.push({ name: "Shelves", color: input.color, positions: shelfSoup });
  }

  // ---- drawers: explicit full-width front panel + explicit tray ----
  const openingW = px1 - px0;
  const openingD = py1;
  const trayW = Math.max(pixelSize, openingW - 2 * fit);
  const trayD = Math.max(pixelSize, openingD - fit);
  const panelPts = buildDrawerPanel(W, frontThk, frontH, c);

  const ov = Math.min(0.8, frontThk * 0.4); // panel/tray overlap (watertight union)
  const drawerDmm = frontThk + trayD;
  // tray centred under the flush panel, sitting just behind it (exact, few tris)
  const trayLocal = buildTray(trayW, trayD, frontH, trayWall, trayFloor);
  const tx = (W - trayW) / 2;
  const ty = frontThk - ov;
  for (let i = 0; i < trayLocal.length; i += 3) {
    trayLocal[i] += tx;
    trayLocal[i + 1] += ty;
  }

  const drawerParts: DrawersPart[] = [];
  for (let k = 0; k < N; k++) {
    const positions = panelPts.slice();
    for (let i = 0; i < trayLocal.length; i++) positions.push(trayLocal[i]);
    // lay the drawers out in a column to the right of the cabinet
    const dx = W + LAYOUT_GAP;
    const dy = k * (drawerDmm + LAYOUT_GAP);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += dx;
      positions[i + 1] += dy;
    }
    drawerParts.push({
      name: N > 1 ? `Drawer ${k + 1}` : "Drawer",
      color: input.drawerColor,
      positions,
    });
  }
  parts.push(...drawerParts);

  const { bboxMm, centerMm } = modelBounds(parts);
  const triangleCount = parts.reduce((s, p) => s + p.positions.length, 0) / 9;

  // ---- 2D preview: cabinet footprint (walls brighter than the floor) ----
  const preview = new Uint8ClampedArray(n * 4);
  const col = input.color;
  const wallAt = (x: number, y: number): number => {
    if (!insideOct(x, y, W, D, c)) return 0;
    const inCavity = x >= px0 && x <= px1 && y >= 0 && y <= py1;
    return inCavity ? floorThk : H;
  };
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = (i + 0.5) * pixelSize;
      const y = (gh - j - 0.5) * pixelSize;
      const z = wallAt(x, y);
      if (z > 1e-9) {
        const o = (j * gw + i) * 4;
        const k = z > floorThk + 1e-9 ? 1 : 0.55; // wall brighter than the floor
        preview[o] = col[0] * k;
        preview[o + 1] = col[1] * k;
        preview[o + 2] = col[2] * k;
        preview[o + 3] = 255;
      }
    }
  }

  const heightAt = (xMm: number, yMm: number): number =>
    wallAt(xMm, yMm);

  // ---- warnings ----
  if (pixelSize < 0.4) {
    warnings.push(
      `Cell size ${pixelSize.toFixed(2)} mm is below a typical 0.4 mm nozzle — ` +
        `lower the resolution or enlarge the cabinet.`
    );
  } else if (pixelSize > 0.8) {
    warnings.push(
      `Cell size ${pixelSize.toFixed(2)} mm is coarse — the drawer trays may ` +
        `show visible steps; raise the resolution.`
    );
  }
  if (wall < 1.2) {
    warnings.push(
      `A ${wall.toFixed(1)} mm cabinet wall is thin — 2 mm or more resists ` +
        `warping and carries the shelves better.`
    );
  }
  if (ch < 8) {
    warnings.push(
      `Each compartment is only ${ch.toFixed(1)} mm tall — most contents need ` +
        `more room; increase the cabinet height or use fewer drawers.`
    );
  }
  if (fit < 0.2) {
    warnings.push(
      `Fit clearance ${fit.toFixed(2)} mm is tight — drawers may bind; ` +
        `0.2–0.4 mm suits most FDM printers.`
    );
  }
  if (c > 0.5) {
    warnings.push(
      `A ${c.toFixed(1)} mm chamfer leaves the bottom face smaller than the ` +
        `top — the overhanging bevel prints best with a brim.`
    );
  }

  return {
    parts,
    gw,
    gh,
    pixelSizeMm: pixelSize,
    widthMm: W,
    heightMm: D,
    depthMm: H,
    drawerCount: N,
    compartmentHeightMm: ch,
    chamferMm: c,
    triangleCount,
    bboxMm,
    centerMm,
    preview,
    heightAt,
    warnings,
  };
}

