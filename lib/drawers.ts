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
import {
  DECOR_FACE_LABELS,
  faceAxes,
  faceDecor,
  layoutFace,
  placePart,
  planeDirection,
  planePoint,
  shiftSoup,
  sliceRows,
  soupSize2D,
  type DecorFace,
  type DecorInput,
  type FaceGrid,
  type FacePlane,
  type RecessRect,
} from "./decor";
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
  /** Width of the two side rails that form each shelf (mm). The drawer tray
   *  rests on them and the middle of the compartment stays open — a full slab
   *  would waste filament (the reference "?"-block drawers do the same). */
  shelfRailMm: number;
  /** Number of drawers / compartments. */
  drawerCount: number;
  /** Drawer tray wall thickness (mm). */
  trayWallMm: number;
  /** Drawer tray floor thickness (mm). */
  trayFloorMm: number;
  /** Drawer front panel thickness (mm). */
  frontMm: number;
  /** Drawer-to-opening fit clearance, per enclosed side (mm). Also the dovetail
   *  joint clearance between a front panel and its tray. */
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
  /** Drawer tray colour. */
  drawerColor: RGB;
  /** Drawer front colour (the fronts print as their own parts). */
  frontColor: RGB;
  /** Tray wall style for the three non-front walls. */
  trayWallStyle: "solid" | "hex";
  /** Hex hole size (across flats, mm) when `trayWallStyle` is "hex". */
  hexMm: number;
  /** Optional image decoration: a recess cut into each chosen face plus one
   *  printed part per inlaid colour, to glue in (see `lib/decor.ts`). */
  decor?: DecorInput;
}

export interface DrawersPart {
  name: string;
  color: RGB;
  positions: number[];
}

export interface DrawersResult {
  parts: DrawersPart[];
  /**
   * The same drawers pushed home into the cabinet — the panel's back flush on
   * the cabinet's front face, its grooves straddling the compartment's tenons,
   * with the tray slid in behind it. Held in the model's own space (x = width,
   * y = depth, z = height) so the 3D viewer shows the chest standing upright
   * with its drawers in, rather than lying on its back as it prints.
   */
  assembled: {
    parts: DrawersPart[];
    /** How far a drawer slides out when the preview opens it (mm). */
    openMm: number;
    bboxMm: { x: number; y: number; z: number };
    centerMm: { x: number; y: number };
  };
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
  /** What the image decoration added, if any. */
  decor?: {
    /** Faces carrying a recess (the front is split across the drawers). */
    faces: DecorFace[];
    /** Number of printed inlay parts. */
    partCount: number;
    /** Recess depth actually used (mm), after clamping. */
    recessMm: number;
    /** Inlay part thickness (mm). */
    thicknessMm: number;
    /** Cell size of the finest face grid (mm). */
    cellMm: number;
  };
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
 *
 * Only safe while `C` is strictly off every face's plane: if a face lies in a
 * plane through `C` the test is a tie, the winding is left as given, and an
 * inward-facing face renders see-through (and `analyzeEdges`-style checks, which
 * count undirected edges, won't notice). Use `pushFace` with an explicit
 * outward direction there — e.g. the drawer front's groove floors, which sit on
 * the panel's mid-plane.
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
  pushPolygonFlat(out, outer, 1, y, dir, [hole]);
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
/**
 * Append a polygon oriented so its normal points along `dir` (its outward
 * direction). Used where the solid's centroid is not on the material side of
 * the face — cavity / pocket walls, and the drawer tray's inner faces.
 *
 * `keepDegenerate` keeps zero-area triangles. earcut emits such triangles when
 * a hole ring is collinear with a face edge (the hex honeycomb does this); they
 * add no area, but dropping them would leave the shared edges with only one
 * triangle, i.e. a hole in the mesh.
 */
function pushFace(
  out: number[],
  pts: V3[],
  dir: V3,
  keepDegenerate = false
): void {
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
  if (nx === 0 && ny === 0 && nz === 0 && !keepDegenerate) return;
  const dot = nx * dir[0] + ny * dir[1] + nz * dir[2];
  const P = dot < 0 ? [pts[0], ...pts.slice(1).reverse()] : pts;
  for (let i = 1; i < n - 1; i++) {
    const a = P[0], b = P[i], d = P[i + 1];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
    const cX = e1y * e2z - e1z * e2y;
    const cY = e1z * e2x - e1x * e2z;
    const cZ = e1x * e2y - e1y * e2x;
    if (Math.abs(cX) + Math.abs(cY) + Math.abs(cZ) < 1e-9 && !keepDegenerate) {
      continue;
    }
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
 * Clip a closed triangle soup by the half-space `n · p ≤ d`, keeping that side
 * and closing the cut with a cap so the result stays a closed solid. Only ever
 * used to trim a drawer front's **convex** corner — the cube's front-to-back
 * (long-edge) chamfers, which a section sweep cannot express and which sit well
 * away from the panel's grooves — so the cut cross-section is a single simple
 * loop. Cut edges are stitched into that loop and fanned; vertices are welded
 * (0.001 mm) and degenerate triangles dropped, so the seam stays watertight even
 * where the cut plane grazes a mesh vertex (as it does at the panel's corners).
 */
function clipHalfSpace(positions: number[], n: V3, d: number): number[] {
  const out: number[] = [];
  const sd = (p: number[]) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d;
  // weld every point on a 0.001 mm grid so shared cut points coincide exactly
  const kOf = (p: number[]) =>
    `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
  const pts = new Map<string, number[]>();
  const put = (p: number[]): string => {
    const k = kOf(p);
    if (!pts.has(k)) pts.set(k, p);
    return k;
  };
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  // drop degenerate (collinear / welded-together) triangles
  const tri = (a: number[], b: number[], c: number[]): void => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (Math.abs(cx) + Math.abs(cy) + Math.abs(cz) < 1e-9) return;
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const p: number[][] = [
      [positions[i], positions[i + 1], positions[i + 2]],
      [positions[i + 3], positions[i + 4], positions[i + 5]],
      [positions[i + 6], positions[i + 7], positions[i + 8]],
    ];
    const s = p.map(sd);
    const poly: number[][] = [];
    const on: string[] = [];
    for (let k = 0; k < 3; k++) {
      const a = p[k];
      const b = p[(k + 1) % 3];
      const sa = s[k];
      const sb = s[(k + 1) % 3];
      if (sa <= 1e-9) {
        const ka = put(a);
        poly.push(pts.get(ka)!);
        if (Math.abs(sa) <= 1e-6) on.push(ka);
      }
      if ((sa < -1e-9 && sb > 1e-9) || (sa > 1e-9 && sb < -1e-9)) {
        const t = sa / (sa - sb);
        const ka = put([
          a[0] + t * (b[0] - a[0]),
          a[1] + t * (b[1] - a[1]),
          a[2] + t * (b[2] - a[2]),
        ]);
        poly.push(pts.get(ka)!);
        on.push(ka);
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      tri(poly[0], poly[k], poly[k + 1]);
    }
    if (on.length === 2 && on[0] !== on[1]) link(on[0], on[1]);
  }
  // cap: walk each cut loop and fan it (wound outward along +n)
  const seen = new Set<string>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: string[] = [start];
    seen.add(start);
    let prev = "";
    let cur = start;
    for (;;) {
      const next = [...(adj.get(cur) ?? [])].find(
        (v) => v !== prev && !seen.has(v)
      );
      if (next === undefined) break;
      seen.add(next);
      loop.push(next);
      prev = cur;
      cur = next;
    }
    // Fan from the loop's centroid: every boundary edge is used exactly once and
    // the spokes are shared, even where the cut loop runs straight (collinear).
    const loopPts = loop.map((k) => pts.get(k)!);
    const c = [0, 1, 2].map(
      (a) => loopPts.reduce((s, p) => s + p[a], 0) / loopPts.length
    );
    for (let k = 0; k < loopPts.length; k++) {
      pushFace(
        out,
        [loopPts[k] as V3, loopPts[(k + 1) % loopPts.length] as V3, c as V3],
        n
      );
    }
  }
  return out;
}


/**
 * The cabinet: a rectangular box with a straight 45° chamfer `c` on all twelve
 * outer edges, minus a rectangular pocket open at the front (the drawer cavity).
 * Returns one closed, manifold triangle soup. The pocket is
 * [px0,px1] × [0,py1] × [pz0,pz1]; the caller guarantees c < wall/floor/roof so
 * the pocket stays clear of the chamfers and the front ring keeps a rim.
 *
 * The shell spans the cube from its front plane back, so its own front face is
 * the cube's chamfered cross-section — a full square with the four corners cut
 * by `c`. The flush drawer fronts carry the same cross-section and close it, so
 * a shut chest is exactly a chamfered cube (the bevel is never ramped in).
 *
 * `pockets` sinks a decorative recess into any of the five visible faces (the
 * shell's front face is hidden behind the drawer fronts, so the front is
 * decorated on the panels instead — see `buildDrawerPanel`).
 */
function buildChamferedCabinet(
  W: number, D: number, H: number, c: number,
  px0: number, px1: number, py1: number, pz0: number, pz1: number,
  pockets: Partial<Record<DecorFace, { rect: RecessRect; depth: number }>> = {}
): number[] {
  const out: number[] = [];
  const C: V3 = [W / 2, D / 2, H / 2];

  const dedupe = (pts: [number, number][]): [number, number][] => {
    const near = (a: [number, number], b: [number, number]) =>
      Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    const kept = pts.filter((p, i) => i === 0 || !near(p, pts[i - 1]));
    if (kept.length > 1 && near(kept[kept.length - 1], kept[0])) kept.pop();
    return kept;
  };
  /** One flat face: a plain polygon, or a recess with a ring around the design. */
  const face = (id: DecorFace, flat: () => void) => {
    const p = pockets[id];
    if (!p) {
      flat();
      return;
    }
    const { plane, w, h } = shellFaceFrame(id, W, D, H, c);
    pushDecorPocket(
      out,
      [[0, 0], [w, 0], [w, h], [0, h]],
      p.rect,
      plane,
      p.depth
    );
  };
  // (x, y): the bottom/top face, inset by `c` on all four sides
  const plan = dedupe([[c, 0], [W - c, 0], [W - c, D - c], [c, D - c]]);
  // (y, z): the left/right face, inset by `c` on all four sides
  const side = dedupe([[0, c], [D - c, c], [D - c, H - c], [0, H - c]]);
  face("bottom", () => pushPolygonFlat(out, plan, 2, 0, [0, 0, -1])); // z=0
  face("top", () => pushPolygonFlat(out, plan, 2, H, [0, 0, 1])); // z=H
  face("left", () => pushPolygonFlat(out, side, 0, 0, [-1, 0, 0])); // x=0
  face("right", () => pushPolygonFlat(out, side, 0, W, [1, 0, 0])); // x=W
  face("back", () =>
    pushOriented(out, [[c, D, c], [c, D, H - c], [W - c, D, H - c], [W - c, D, c]], C)
  ); // y=D

  // back vertical-edge chamfers (span z from c to H−c)
  pushOriented(out, [[0, D - c, c], [0, D - c, H - c], [c, D, H - c], [c, D, c]], C); // x+(D−y)=c
  pushOriented(out, [[W, D - c, c], [W - c, D, c], [W - c, D, H - c], [W, D - c, H - c]], C); // (W−x)+(D−y)=c

  // 2 back X-parallel edge chamfers (span x from c to W−c)
  pushOriented(out, [[c, D - c, 0], [W - c, D - c, 0], [W - c, D, c], [c, D, c]], C); // (D−y)+z=c (back-bottom)
  pushOriented(out, [[c, D, H - c], [W - c, D, H - c], [W - c, D - c, H], [c, D - c, H]], C); // (D−y)+(H−z)=c

  // 4 Y-parallel (long-edge) chamfers — straight, spanning the whole depth
  pushOriented(out, [[0, 0, c], [0, D - c, c], [c, D - c, 0], [c, 0, 0]], C);         // x+z=c (left-bottom)
  pushOriented(out, [[0, 0, H - c], [c, 0, H], [c, D - c, H], [0, D - c, H - c]], C); // x+(H−z)=c (left-top)
  pushOriented(out, [[W, 0, c], [W - c, 0, 0], [W - c, D - c, 0], [W, D - c, c]], C); // (W−x)+z=c (right-bottom)
  pushOriented(out, [[W, 0, H - c], [W, D - c, H - c], [W - c, D - c, H], [W - c, 0, H]], C); // (W−x)+(H−z)=c

  // 4 corner triangles (one per back vertex — the front corners are the front
  // face's cut corners, which need no extra face)
  for (const cx of [0, W]) {
    for (const cz of [0, H]) {
      const ix = cx === 0 ? 1 : -1;
      const iz = cz === 0 ? 1 : -1;
      pushOriented(out, [
        [cx, D - c, cz + iz * c],
        [cx + ix * c, D, cz + iz * c],
        [cx + ix * c, D - c, cz],
      ], C);
    }
  }

  // front face (y=0): the cube's chamfered cross-section (its four corners cut
  // by `c`) with the pocket mouth as a hole
  pushRing(
    out,
    [[c, 0], [W - c, 0], [W, c], [W, H - c], [W - c, H], [c, H], [0, H - c], [0, c]],
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
 * A dovetail groove (in a panel) or rib (on a tray wall). `neck`/`head` are the
 * half-widths at the mouth and at the far end, `depth` the reach into the
 * material. Both slide together along Z (the print's up axis), so every face
 * stays vertical and prints support-free.
 */
interface Dovetail {
  cx: number;
  neck: number;
  head: number;
  depth: number;
}

/**
 * Append a flat polygon (≥3 pts, optional holes) lying on a constant-`axis`
 * plane, triangulated with earcut. `pts2D` is in the plane's other two axes:
 * axis 0 → (y, z), axis 1 → (x, z), axis 2 → (x, y). Needed wherever a face is
 * not convex (the cabinet's collar fans out to the full front square, so its
 * bottom/top/left/right faces have a reflex corner) — a fan would overlap itself.
 */
function pushPolygonFlat(
  out: number[],
  pts2D: [number, number][],
  axis: 0 | 1 | 2,
  at: number,
  dir: V3,
  holes: [number, number][][] = []
): void {
  const flat: number[] = [];
  for (const [u, v] of pts2D) flat.push(u, v);
  const idx: number[] = [];
  for (const h of holes) {
    idx.push(flat.length / 2);
    for (const [u, v] of h) flat.push(u, v);
  }
  const tris = earcut(flat, idx.length ? idx : undefined, 2);
  const to3 = (u: number, v: number): V3 =>
    axis === 0 ? [at, u, v] : axis === 1 ? [u, at, v] : [u, v, at];
  for (let i = 0; i < tris.length; i += 3) {
    const t: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = tris[i + k] * 2;
      t.push(to3(flat[j], flat[j + 1]));
    }
    pushFace(out, t, dir);
  }
}

/** Append a flat polygon (≥3 pts, optional holes) at a constant z, oriented
 *  along `dir`. */
function pushPolygonZ(
  out: number[],
  pts2D: [number, number][],
  z: number,
  dir: V3,
  holes: [number, number][][] = []
): void {
  pushPolygonFlat(out, pts2D, 2, z, dir, holes);
}

/**
 * A shell face's design plane and its usable rectangle (w × h) in that plane:
 * the flat region between the cube's chamfer bands. `D` is the shell's own
 * depth: the bottom/top/left/right faces run from the front plane (y = 0) back
 * to the rear chamfer, so their depth extends to `D − c`.
 */
export function shellFaceFrame(
  face: DecorFace,
  W: number,
  D: number,
  H: number,
  c: number
): { plane: FacePlane; w: number; h: number } {
  const { U, V, n } = faceAxes(face);
  const w = W - 2 * c;
  const d = Math.max(1, D - c);
  const hgt = H - 2 * c;
  switch (face) {
    case "front":
      return { plane: { O: [c, 0, c], U, V, n }, w, h: hgt };
    case "back":
      return { plane: { O: [W - c, D, c], U, V, n }, w, h: hgt };
    case "left":
      return { plane: { O: [0, D - c, c], U, V, n }, w: d, h: hgt };
    case "right":
      return { plane: { O: [W, 0, c], U, V, n }, w: d, h: hgt };
    case "top":
      return { plane: { O: [c, 0, H], U, V, n }, w, h: d };
    case "bottom":
      return { plane: { O: [c, D - c, 0], U, V, n }, w, h: d };
  }
}

/**
 * Triangulate a polygon (with holes) lying on a face's design plane, `w` along
 * the face's outward normal, wound so the normal points along `dir`. Points are
 * the plane's (u, v). earcut keeps the hole rings on their own vertices, so the
 * caps weld to the pocket walls exactly.
 */
function pushPlaneFace(
  out: number[],
  outer: [number, number][],
  holes: [number, number][][],
  plane: FacePlane,
  w: number,
  dir: V3
): void {
  const flat: number[] = [];
  for (const [u, v] of outer) flat.push(u, v);
  const idx: number[] = [];
  for (const h of holes) {
    idx.push(flat.length / 2);
    for (const [u, v] of h) flat.push(u, v);
  }
  const tris = earcut(flat, idx.length ? idx : undefined, 2);
  for (let i = 0; i < tris.length; i += 3) {
    const t: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = tris[i + k] * 2;
      t.push(planePoint(plane, flat[j], flat[j + 1], w));
    }
    pushFace(out, t, dir);
  }
}

/**
 * Sink a rectangular recess into a flat face: the face outline keeps the recess
 * as a hole, and the recess gets four walls and a floor. `rect` is in the face
 * plane's (u, v) mm frame and `outer` is the face outline in the same frame.
 *
 * A rectangular hole is deliberate: earcut drops *collinear* vertices from hole
 * rings, so a recess following a pixel outline could never weld to walls emitted
 * per outline segment. The decoration's silhouette comes from the background
 * plate that sits in this recess (see `lib/decor.ts`).
 */
function pushDecorPocket(
  out: number[],
  outer: [number, number][],
  rect: RecessRect,
  plane: FacePlane,
  depth: number
): void {
  const r: [number, number][] = [
    [rect.u0, rect.v0],
    [rect.u1, rect.v0],
    [rect.u1, rect.v1],
    [rect.u0, rect.v1],
  ];
  pushPlaneFace(out, outer, [r], plane, 0, plane.n);
  const wall = (p: [number, number], q: [number, number], du: number, dv: number) =>
    pushFace(
      out,
      [
        planePoint(plane, p[0], p[1], 0),
        planePoint(plane, q[0], q[1], 0),
        planePoint(plane, q[0], q[1], -depth),
        planePoint(plane, p[0], p[1], -depth),
      ],
      planeDirection(plane, du, dv)
    );
  wall(r[0], r[1], 0, 1); // bottom edge, void above it
  wall(r[1], r[2], -1, 0); // right edge, void to its left
  wall(r[2], r[3], 0, -1); // top edge, void below it
  wall(r[3], r[0], 1, 0); // left edge, void to its right
  pushPlaneFace(out, r, [], plane, -depth, plane.n);
}

/** A flat-top regular hexagon (across-flats `a`) centred at (cx, cy). */
function hexPoly(cx: number, cy: number, a: number): [number, number][] {
  const r = a / Math.sqrt(3); // circumradius
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 3) * i; // flat-top: a vertex on the +x axis
    pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  return pts;
}

/** Honeycomb of hex holes filling a [0,w] × [0,h] area, inset by `margin`. */
function hexHoles(
  w: number,
  h: number,
  acrossFlats: number,
  margin: number
): [number, number][][] {
  const a = Math.max(2.5, acrossFlats);
  const web = Math.max(1.2, a * 0.22);
  const pitch = a + web; // flat-to-flat centre spacing
  const r = a / Math.sqrt(3);
  const colStep = 1.5 * (pitch / Math.sqrt(3)); // flat-top column spacing
  const out: [number, number][][] = [];
  const x0 = margin + r;
  const x1 = w - margin - r;
  const y0 = margin + a / 2;
  const y1 = h - margin - a / 2;
  if (x1 <= x0 || y1 <= y0) return out;
  let col = 0;
  for (let cx = x0; cx <= x1 + 1e-9; cx += colStep, col++) {
    const off = (col % 2) * (pitch / 2);
    for (let cy = y0 + off; cy <= y1 + 1e-9; cy += pitch) {
      out.push(hexPoly(cx, cy, a));
    }
  }
  return out;
}

/**
 * Append a rectangular wall between two parallel planes, perforated with hex
 * holes (`holes`, in the wall's (u, v) plane). `axis` is the wall normal: the
 * plate spans [u0,u1] × [v0,v1] on the outer surface (coordinate `outerAt`) and
 * [iu0,iu1] × [iv0,iv1] on the inner one (`innerAt`); `outDir` is the outward
 * direction along `axis`. Holes must sit inside the inner rectangle.
 */
function pushHoleyWall(
  out: number[],
  axis: 0 | 1 | 2,
  outerAt: number,
  innerAt: number,
  outDir: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  iu0: number,
  iu1: number,
  iv0: number,
  iv1: number,
  holes: [number, number][][]
): void {
  const to3 = (u: number, v: number, c: number): V3 =>
    axis === 0 ? [c, u, v] : axis === 1 ? [u, c, v] : [u, v, c];
  const nAxis: V3 = axis === 0 ? [outDir, 0, 0] : axis === 1 ? [0, outDir, 0] : [0, 0, outDir];
  const nIn: V3 = [nAxis[0] * -1, nAxis[1] * -1, nAxis[2] * -1];

  const face = (
    at: number,
    a0: number,
    a1: number,
    b0: number,
    b1: number,
    normal: V3
  ) => {
    const flat: number[] = [a0, b0, a1, b0, a1, b1, a0, b1];
    const holeStarts: number[] = [];
    for (const h of holes) {
      holeStarts.push(flat.length / 2);
      for (const [hu, hv] of h) flat.push(hu, hv);
    }
    const tris = earcut(flat, holeStarts.length ? holeStarts : undefined, 2);
    for (let i = 0; i < tris.length; i += 3) {
      const t: V3[] = [];
      for (let k = 0; k < 3; k++) {
        const j = tris[i + k] * 2;
        t.push(to3(flat[j], flat[j + 1], at));
      }
      // keep zero-area tris: earcut emits them where collinear hole rings meet,
      // and dropping them would leave holes in the mesh
      pushFace(out, t, normal, true);
    }
  };

  face(outerAt, u0, u1, v0, v1, nAxis);
  face(innerAt, iu0, iu1, iv0, iv1, nIn);

  // hole side walls
  for (const h of holes) {
    const cU = h.reduce((s, p) => s + p[0], 0) / h.length;
    const cV = h.reduce((s, p) => s + p[1], 0) / h.length;
    for (let i = 0; i < h.length; i++) {
      const p = h[i];
      const q = h[(i + 1) % h.length];
      const mU = (p[0] + q[0]) / 2 - cU;
      const mV = (p[1] + q[1]) / 2 - cV;
      const nl = Math.hypot(mU, mV) || 1;
      const dir: V3 =
        axis === 0
          ? [0, mU / nl, mV / nl]
          : axis === 1
            ? [mU / nl, 0, mV / nl]
            : [mU / nl, mV / nl, 0];
      pushFace(
        out,
        [to3(p[0], p[1], outerAt), to3(q[0], q[1], outerAt), to3(q[0], q[1], innerAt), to3(p[0], p[1], innerAt)],
        dir
      );
    }
  }
}

/**
 * A drawer front panel: a rectangular prism (X 0..W, Y 0..depth, Z 0..height)
 * *inset into* the cube's front face — it occupies the front `depth` mm of the
 * box, flush with the front plane — with 45° chamfers `c` on the four edges of
 * its front face, so a closed chest reads as one chamfered cube. The top/bottom
 * chamfers are only wanted on the outermost drawers (`bevelTop`/`bevelBottom`);
 * the middle panels butt against a shelf, so their ends stay square. Its back
 * (y = depth) carries the dovetail GROOVES the tray's tenons slide into.
 *
 * The side chamfers come straight out of the section; the top/bottom ones clip
 * the extruded ends (and stop short of the grooves). The outermost panels' outer
 * ends also get the cube's **front-to-back** (long-edge) chamfers — the `x/z`
 * corner cuts, which a section sweep cannot express — so the fronts alone
 * complete the cube's chamfer.
 */
function buildDrawerPanel(
  W: number,
  depth: number,
  height: number,
  c: number,
  grooves: Dovetail[],
  bevelTop: boolean,
  bevelBottom: boolean,
  /** Decorative recess in the front face: the plane's (u, v) are (x, z) with its
   *  origin at the panel's own (c, 0, z0) — i.e. the front face is at y = 0 and
   *  the design's v = 0 sits at `plane.O[2]`. */
  pocket: { rect: RecessRect; plane: FacePlane; depth: number } | null = null
): number[] {
  const out: number[] = [];
  const sorted = [...grooves].sort((a, b) => a.cx - b.cx);
  const deepest = sorted.reduce((m, g) => Math.max(m, g.depth), 0);
  // how deep the end cuts go: `c`, but never into a groove's channel
  const cut = Math.min(c, Math.max(0, depth - deepest - 0.2));
  const topCut = bevelTop ? cut : 0;
  const botCut = bevelBottom ? cut : 0;
  const zTop = (y: number) => height - Math.max(0, topCut - y);
  const zBot = (y: number) => Math.max(0, botCut - y);

  // section edges, split where the end cuts begin so every face stays planar
  const sec: [number, number][] = [[0, c], [0, depth]];
  const pushGrooves = (s: [number, number][]) => {
    for (const g of sorted) {
      s.push([g.cx - g.neck, depth]);
      s.push([g.cx - g.head, depth - g.depth]);
      s.push([g.cx + g.head, depth - g.depth]);
      s.push([g.cx + g.neck, depth]);
    }
  };
  pushGrooves(sec);
  sec.push([W, depth], [W, c]);
  if (cut > 0) sec.push([W - c + cut, cut]);
  sec.push([W - c, 0], [c, 0]);
  if (cut > 0) sec.push([c - cut, cut]);

  // caps (earcut): where an end is cut the cap is the section clipped to y ≥ cut
  const cap = (z: number, dir: V3, bevelled: boolean) => {
    if (!bevelled) {
      pushPolygonZ(out, sec, z, dir);
      return;
    }
    const s: [number, number][] = [[0, c], [0, depth]];
    pushGrooves(s);
    s.push([W, depth], [W, c], [W - c + cut, cut], [c - cut, cut]);
    pushPolygonZ(out, s, z, dir);
  };
  cap(0, [0, 0, -1], botCut > 0);
  cap(height, [0, 0, 1], topCut > 0);

  // Side walls: the winding comes from the section itself. `pushOriented`'s
  // interior-point guess cannot be used here — a groove's floor sits at the
  // panel's mid-plane, which contains C, so the dot product is 0 and the inward
  // winding would survive making the groove render see-through.
  let area2 = 0;
  for (let i = 0; i < sec.length; i++) {
    const a = sec[i];
    const b = sec[(i + 1) % sec.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area2 > 0; // +1 = counter-clockwise section (in the x/y plane)
  // The panel's front face (x ∈ [c, W−c], z ∈ [botCut, height − topCut]) is the
  // section edge that lies at y = 0. With a decoration it becomes a ring around
  // the design's recess instead of one quad.
  const frontRect: [number, number][] | null = pocket
    ? [
        [0, botCut - pocket.plane.O[2]],
        [W - 2 * c, botCut - pocket.plane.O[2]],
        [W - 2 * c, height - topCut - pocket.plane.O[2]],
        [0, height - topCut - pocket.plane.O[2]],
      ]
    : null;
  for (let i = 0; i < sec.length; i++) {
    const a = sec[i];
    const b = sec[(i + 1) % sec.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (frontRect && a[1] === 0 && b[1] === 0 && Math.abs(dx) > 1e-9) {
      pushDecorPocket(out, frontRect, pocket!.rect, pocket!.plane, pocket!.depth);
      continue;
    }
    // for a CCW section the outward normal of edge a→b is (dy, −dx)
    pushFace(
      out,
      [
        [a[0], a[1], zBot(a[1])],
        [b[0], b[1], zBot(b[1])],
        [b[0], b[1], zTop(b[1])],
        [a[0], a[1], zTop(a[1])],
      ],
      ccw ? [dy, -dx, 0] : [-dy, dx, 0]
    );
  }

  // the two end cuts themselves, in the planes z = height − cut + y / z = cut − y
  if (topCut > 0) {
    pushFace(
      out,
      [
        [c, 0, height - topCut],
        [W - c, 0, height - topCut],
        [W - c + topCut, topCut, height],
        [c - topCut, topCut, height],
      ],
      [0, -1, 1]
    );
  }
  if (botCut > 0) {
    pushFace(
      out,
      [
        [c, 0, botCut],
        [W - c, 0, botCut],
        [W - c + botCut, botCut, 0],
        [c - botCut, botCut, 0],
      ],
      [0, -1, -1]
    );
  }

  // the cube's front-to-back (long-edge) chamfers, only where the outer end sits
  // at the cube's own bottom/top: the `x ± z = c` corner cuts (a section sweep
  // cannot express them), so the flush front matches the shell's cross-section
  let res = out;
  if (c > 1e-6 && (topCut > 0 || botCut > 0)) {
    if (botCut > 0) {
      res = clipHalfSpace(res, [-1, 0, -1], -c); // x + z ≥ c
      res = clipHalfSpace(res, [1, 0, -1], W - c); // (W − x) + z ≥ c
    }
    if (topCut > 0) {
      res = clipHalfSpace(res, [-1, 0, 1], height - c); // x + (height − z) ≥ c
      res = clipHalfSpace(res, [1, 0, 1], W + height - c); // (W − x) + (height − z) ≥ c
    }
  }
  return res;
}

/**
 * A drawer tray: an open-top box with an **open front** — a floor plus left,
 * right and back walls only (the front panel closes the drawer). Each side
 * wall's exposed front end is cut into a vertical dovetail TENON (`neck`/`head`
 * are half-widths at the end face and at the tip, `depth` the reach forward),
 * which slides into the front panel's matching groove. The three walls are
 * solid or perforated with a hex honeycomb (`hex`, `hexMm` = hole size), to save
 * filament. Built as one explicit closed solid (few triangles; a heightfield
 * would emit per-cell quads).
 */
function buildTray(
  W: number,
  D: number,
  H: number,
  wall: number,
  floor: number,
  neck: number,
  head: number,
  depth: number,
  hex: boolean,
  hexMm: number
): number[] {
  const out: number[] = [];
  const ix0 = wall,
    ix1 = W - wall,
    iy1 = D - wall,
    iz0 = floor;
  const cxL = wall / 2,
    cxR = W - wall / 2;

  // ---- the front (y = 0): the dovetail tenon at each side wall's end, the
  // floor's front edge below the open front, and the walls' exposed ends above
  // it. All split at z = floor (and at the cavity corners) so every edge is
  // shared by exactly two faces.
  const tenonSegs: [number, number, number, number][] = [
    [cxL - neck, 0, cxL - head, -depth],
    [cxL - head, -depth, cxL + head, -depth],
    [cxL + head, -depth, cxL + neck, 0],
    [cxR - neck, 0, cxR - head, -depth],
    [cxR - head, -depth, cxR + head, -depth],
    [cxR + head, -depth, cxR + neck, 0],
  ];
  for (const [x0, y0, x1, y1] of tenonSegs) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const nl = Math.hypot(dx, dy) || 1;
    const n: V3 = [dy / nl, -dx / nl, 0];
    for (const [za, zb] of [
      [0, iz0],
      [iz0, H],
    ]) {
      pushFace(out, [[x0, y0, za], [x1, y1, za], [x1, y1, zb], [x0, y0, zb]], n);
    }
  }
  const frontFaces: [number, number, number, number][] = [
    [0, cxL - neck, 0, iz0],
    [cxL + neck, ix0, 0, iz0],
    [ix0, ix1, 0, iz0],
    [ix1, cxR - neck, 0, iz0],
    [cxR + neck, W, 0, iz0],
    [0, cxL - neck, iz0, H],
    [cxL + neck, ix0, iz0, H],
    [ix1, cxR - neck, iz0, H],
    [cxR + neck, W, iz0, H],
  ];
  for (const [x0, x1, z0, z1] of frontFaces) {
    if (x1 - x0 <= 1e-9 || z1 - z0 <= 1e-9) continue;
    pushFace(out, [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, -1, 0]);
  }

  // ---- the walls: the floor's side (z 0..floor), then the wall above it (plain,
  // or a hex honeycomb through it). Split at the floor so the front faces' edges
  // line up.
  const margin = Math.max(2, hexMm * 0.35);
  const shift = (
    holes: [number, number][][],
    du: number,
    dv: number
  ): [number, number][][] =>
    holes.map((hp) => hp.map(([u, v]) => [u + du, v + dv] as [number, number]));
  const sideHoles = hex
    ? shift(hexHoles(iy1, H - iz0, hexMm, margin), 0, iz0)
    : [];
  const backHoles = hex
    ? shift(hexHoles(ix1 - ix0, H - iz0, hexMm, margin), ix0, iz0)
    : [];

  // left / right walls, split at the floor
  for (const side of [1, -1]) {
    const x = side > 0 ? W : 0;
    const inner = side > 0 ? W - wall : wall;
    pushFace(
      out,
      [
        [x, 0, 0],
        [x, D, 0],
        [x, D, iz0],
        [x, 0, iz0],
      ],
      [side, 0, 0]
    );
    if (sideHoles.length) {
      // (u, v) = (y, z)
      pushHoleyWall(out, 0, x, inner, side, 0, D, iz0, H, 0, iy1, iz0, H, sideHoles);
    } else {
      pushFace(
        out,
        [
          [x, 0, iz0],
          [x, D, iz0],
          [x, D, H],
          [x, 0, H],
        ],
        [side, 0, 0]
      );
    }
  }
  // back wall, split at the floor
  pushFace(
    out,
    [
      [0, D, 0],
      [0, D, iz0],
      [W, D, iz0],
      [W, D, 0],
    ],
    [0, 1, 0]
  );
  if (backHoles.length) {
    // (u, v) = (x, z)
    pushHoleyWall(out, 1, D, iy1, 1, 0, W, iz0, H, ix0, ix1, iz0, H, backHoles);
  } else {
    pushFace(
      out,
      [
        [0, D, iz0],
        [0, D, H],
        [W, D, H],
        [W, D, iz0],
      ],
      [0, 1, 0]
    );
  }

  // ---- bottom (full footprint) and the wall tops (open front => a U) ----
  const plan: [number, number][] = [
    [0, 0],
    [cxL - neck, 0],
    [cxL - head, -depth],
    [cxL + head, -depth],
    [cxL + neck, 0],
    [ix0, 0],
    [ix1, 0],
    [cxR - neck, 0],
    [cxR - head, -depth],
    [cxR + head, -depth],
    [cxR + neck, 0],
    [W, 0],
    [W, D],
    [0, D],
  ];
  const rim: [number, number][] = [
    [0, 0],
    [cxL - neck, 0],
    [cxL - head, -depth],
    [cxL + head, -depth],
    [cxL + neck, 0],
    [ix0, 0],
    [ix0, iy1],
    [ix1, iy1],
    [ix1, 0],
    [cxR - neck, 0],
    [cxR - head, -depth],
    [cxR + head, -depth],
    [cxR + neck, 0],
    [W, 0],
    [W, D],
    [0, D],
  ];
  pushPolygonZ(out, plan, 0, [0, 0, -1]);
  pushPolygonZ(out, rim, H, [0, 0, 1]);

  // ---- cavity walls + floor (the front is open down to y = 0) ----
  if (!sideHoles.length) {
    pushFace(out, [[ix0, 0, iz0], [ix0, iy1, iz0], [ix0, iy1, H], [ix0, 0, H]], [1, 0, 0]); // inner left
    pushFace(out, [[ix1, 0, iz0], [ix1, 0, H], [ix1, iy1, H], [ix1, iy1, iz0]], [-1, 0, 0]); // inner right
  }
  if (!backHoles.length) {
    pushFace(out, [[ix0, iy1, iz0], [ix0, iy1, H], [ix1, iy1, H], [ix1, iy1, iz0]], [0, -1, 0]); // inner back
  }
  pushFace(out, [[ix0, 0, iz0], [ix1, 0, iz0], [ix1, iy1, iz0], [ix0, iy1, iz0]], [0, 0, 1]); // cavity floor
  return out;
}


/** Inside the cabinet's footprint: the bevels fade out, so the front is square. */
function insideOct(x: number, y: number, W: number, D: number, c: number): boolean {
  if (x < 0 || x > W || y < 0 || y > D) return false;
  if (c > 0) {
    // only the back corners are cut — the bevels ramp in from the front face
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
  // The drawer fronts sit *in* the cube's front face — they occupy the front
  // `frontThk` mm and are flush with the front plane — so the cabinet's shell
  // starts that far back. It is built in its own frame (front face at y = 0) and
  // shifted into place below, which keeps the chamfer/pocket maths unchanged.
  const shellD = Math.max(wall + 1, D - frontThk);
  const shellPy = Math.max(1, py1 - frontThk);

  // Print orientation: the cube lies on its back, so its back face rests on the
  // bed and the opening faces up. The roof / floor become vertical walls and the
  // shelf rails stand on edge, so nothing bridges over the cavity. The drawers
  // print in their own (flat) orientation beside it. (x, y, z) -> (x, z, D − y).
  const orient = (arr: number[]): number[] => {
    const out = new Array<number>(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      out[i] = arr[i];
      out[i + 1] = arr[i + 2];
      out[i + 2] = D - arr[i + 1];
    }
    return out;
  };

  // ---- decoration (optional): a recess per chosen face + one part per colour
  // The recess may not break through the face's inner surface, so it is limited
  // by the thinnest thing behind it (and kept clear of the shelf rails, which
  // reach 0.6 mm into the walls).
  const decor = input.decor;
  const decorParts: DrawersPart[] = []; // printed flat, beside the cabinet
  const decorGlued: DrawersPart[] = []; // dropped into their recesses
  const decorWarnings: string[] = [];
  const decorFaces: DecorFace[] = [];
  const shellPockets: Partial<
    Record<DecorFace, { rect: RecessRect; depth: number }>
  > = {};
  const shellLimit = Math.max(0.4, Math.min(wall, floorThk, roofThk) - 0.9);
  const wantRecess = Math.max(0, decor?.recessMm ?? 0);
  const wantProud = Math.max(0, decor?.proudMm ?? 0);
  let decorSlotY = 0; // print-layout cursor for the inlay parts (4th column)
  const decorSlotX = 3 * W + 3 * LAYOUT_GAP;
  let decorThin = false;
  let decorCellMm = 0;
  let decorRecessUsed = 0;
  let decorThicknessUsed = 0;

  /**
   * Build one face's decoration: the recess rectangle plus its printable
   * pieces (one per inlaid colour, then the background plate). The pieces are
   * added to the print layout column and to the glued preview; the recess is
   * handed back for the face to cut.
   */
  const decorateFace = (
    face: DecorFace,
    plane: FacePlane,
    fg: FaceGrid,
    recess: number,
    proud: number,
    /** The plate's colour, or "face" for the face's own colour. */
    faceColor: RGB,
    name: (index: number) => string,
    gluedOffset: V3
  ): { rect: RecessRect; depth: number } | null => {
    if (!decor) return null;
    const clr = Math.max(0, decor.clearanceMm);
    const thickness = Math.max(0.2, recess + proud - 0.05);
    const fd = faceDecor(fg, decor.palette, decor.inlay, {
      recessMm: recess,
      proudMm: proud,
      clearanceMm: clr,
      background: decor.backgroundInlay
        ? decor.background === "face"
          ? faceColor
          : decor.background
        : null,
      name,
    });
    if (!fd) return null;
    if (fd.thin) decorThin = true;
    decorCellMm = decorCellMm === 0 ? fg.pixelMm : Math.min(decorCellMm, fg.pixelMm);
    if (decorRecessUsed === 0) decorRecessUsed = recess;
    decorThicknessUsed = fd.thicknessMm;
    if (!decorFaces.includes(face)) decorFaces.push(face);
    for (const piece of fd.pieces) {
      decorParts.push({
        name: piece.name,
        color: piece.color,
        positions: shiftSoup(piece.soup, decorSlotX, decorSlotY),
      });
      decorSlotY += soupSize2D(piece.soup).h + LAYOUT_GAP;
      decorGlued.push({
        name: piece.name,
        color: piece.color,
        positions: shiftSoup(
          placePart(piece.soup, plane, fd.thicknessMm, proud),
          gluedOffset[0],
          gluedOffset[1],
          gluedOffset[2]
        ),
      });
    }
    return recess > 1e-6 ? { rect: fd.rect, depth: recess } : null;
  };

  // the shell's own faces (the front is the drawer fronts' front faces)
  for (const face of decor?.faces ?? []) {
    if (face === "front") continue;
    const { plane, w, h } = shellFaceFrame(face, W, shellD, H, c);
    const fg = layoutFace(decor!.design, w, h, decor!.sizePct, decor!.offset);
    const recess = Math.min(wantRecess, shellLimit);
    const pocket = decorateFace(
      face,
      plane,
      fg,
      recess,
      wantProud,
      input.color,
      (i) => `${DECOR_FACE_LABELS[face]} ${i < 0 ? "base" : `decor ${i + 1}`}`,
      [0, frontThk, 0]
    );
    if (pocket) shellPockets[face] = pocket;
  }

  // ---- cabinet: one explicit chamfered solid with a front pocket. The soup is
  // kept in the model's own space (x = width, y = depth, z = height) so the
  // assembled preview can drop the drawers into it; the printed part rotates it.
  const cabinetSoup = buildChamferedCabinet(
    W,
    shellD,
    H,
    c,
    px0,
    px1,
    shellPy,
    pz0,
    pz1,
    shellPockets
  );

  const parts: DrawersPart[] = [
    { name: "Cabinet", color: input.color, positions: orient(cabinetSoup) },
  ];

  // ---- shelves: exact boxes (disjoint -> one watertight part) ----
  const interiorH = Math.max(N + 1, pz1 - pz0 - (N - 1) * shelfThk);
  const ch = interiorH / N;
  /** Height of one drawer *tray* — it has to fit its compartment. */
  const trayH = Math.max(trayFloor + 1, ch - gap);
  /**
   * Z range of the *front panel* for drawer `k`. Panels are cut to their
   * compartment plus half of each dividing shelf, so consecutive fronts almost
   * touch (only `gap` between them) and the outermost ones run out to the
   * cabinet's bottom and top faces — the closed chest shows panels, not cabinet.
   */
  const frontZ = (k: number): [number, number] => {
    const shelfMid = (j: number): number =>
      j < 0 ? 0 : j >= N - 1 ? H : pz0 + j * (ch + shelfThk) + ch + shelfThk / 2;
    const lo = shelfMid(k - 1) + (k > 0 ? gap / 2 : 0);
    const hi = shelfMid(k) - (k < N - 1 ? gap / 2 : 0);
    return [lo, Math.max(lo + 1, hi)];
  };
  if (N > 1) {
    const overlap = Math.min(wall, 0.6);
    // Each shelf is two side rails rather than a full slab: the drawer tray
    // rests on them and the middle of the compartment stays open (far less
    // filament). Clamped so the two rails never meet in the middle.
    const rail = clamp(
      input.shelfRailMm,
      pixelSize,
      Math.max(pixelSize, (px1 - px0) / 2 - 0.5)
    );
    const shelfSoup: number[] = [];
    for (let k = 0; k < N - 1; k++) {
      const z0 = pz0 + k * (ch + shelfThk) + ch;
      pushBox(shelfSoup, px0 - overlap, px0 + rail, 0, shellPy + overlap, z0, z0 + shelfThk);
      pushBox(shelfSoup, px1 - rail, px1 + overlap, 0, shellPy + overlap, z0, z0 + shelfThk);
    }
    // The shelves are the same colour as the cabinet, so they are welded into
    // its mesh (overlapping the walls) rather than exported as their own object.
    for (const v of shelfSoup) cabinetSoup.push(v);
  }
  // shift the shell (and its shelves) back: the drawer fronts fill the cube's
  // front slab, flush with the front plane
  for (let i = 1; i < cabinetSoup.length; i += 3) cabinetSoup[i] += frontThk;
  parts[0].positions = orient(cabinetSoup);

  // ---- drawers: a separate full-width front + an open tray, joined by a
  // dovetail (fronts and trays print as their own parts, one colour each) ----
  const openingW = px1 - px0;
  const openingD = shellPy;
  const trayW = Math.max(pixelSize, openingW - 2 * fit);
  // the tray runs from the panel's back face (y = frontThk) into the cavity
  const trayD = Math.max(pixelSize, openingD - fit);
  const tx = (W - trayW) / 2;

  // Dovetail: each side wall's exposed front end is cut into a vertical dovetail
  // tenon — narrow at the wall's end face, flared back at the tip — and the
  // front panel's back carries the matching groove. Both run along Z (the
  // print's up axis), so every joint face is vertical and prints support-free;
  // `dvClr` (the drawer fit clearance) lets them slide together after printing.
  const dvDepth = clamp(
    Math.min(frontThk * 0.5, frontThk - c - 0.2), // leaves room for the end cut
    1.2,
    3
  ); // tenon groove depth in the panel
  const dvClr = Math.max(0.3, fit);
  const half = trayWall / 2;
  const tenonNeck = Math.max(0.25, half - Math.min(0.8, half * 0.5));
  const tenonHead = Math.max(tenonNeck + 0.25, half - Math.min(0.25, half * 0.15));
  const dvFlare = tenonHead - tenonNeck;
  // the groove is the tenon's trapezoid offset outward by `dvClr` (parallel
  // flanks), so it can never bind on the way in
  const gMouth = tenonNeck + (dvFlare * dvClr) / dvDepth + dvClr;
  const gBase = gMouth + dvFlare;
  const cxL = trayWall / 2;
  const cxR = trayW - trayWall / 2;
  const grooves: Dovetail[] = [
    { cx: tx + cxL, neck: gMouth, head: gBase, depth: dvDepth },
    { cx: tx + cxR, neck: gMouth, head: gBase, depth: dvDepth },
  ];

  const hexOn = input.trayWallStyle === "hex";

  // The front's decoration: the design covers the cube's whole front elevation
  // (inset by the chamfer and the panels' end cuts) and is then split per panel,
  // so no part can straddle two drawers or reach past a panel's own edge. A
  // front inlay is always flush — a raised one would catch on a shelf.
  const frontCut = Math.min(c, Math.max(0, frontThk - dvDepth - 0.2));
  const frontRecess = Math.min(wantRecess, Math.max(0.4, frontThk - dvDepth - 0.6));
  const frontGrid =
    decor && decor.faces.includes("front")
      ? layoutFace(decor.design, W - 2 * c, H - 2 * frontCut, decor.sizePct, decor.offset)
      : null;

  const trayLocal = buildTray(
    trayW,
    trayD,
    trayH,
    trayWall,
    trayFloor,
    tenonNeck,
    tenonHead,
    dvDepth,
    hexOn,
    input.hexMm
  );

  const drawerDmm = Math.max(frontThk, trayD + dvDepth) + 1;
  const frontParts: DrawersPart[] = [];
  const trayParts: DrawersPart[] = [];
  // assembled pose, for the second preview: every drawer pushed home. A panel's
  // local frame has its front at y = 0 and its back at y = frontThk, so shifting
  // it back by `frontThk` lands its back on the cabinet's front face (y = 0) with
  // the grooves straddling that compartment's tenons; the tray (local y = 0 is
  // the wall end face, its tenons reaching to y = -dvDepth) then slides straight
  // in behind it, centred on the opening by `tx` and sat on the compartment floor.
  const assembledParts: DrawersPart[] = [
    { name: "Cabinet", color: input.color, positions: cabinetSoup.slice() },
  ];
  for (let k = 0; k < N; k++) {
    const [fz0, fz1] = frontZ(k);
    // this panel's band of the front elevation: the design is cut at the drawer
    // seams (one clear cell in from the panel's own face edges), so each panel
    // carries its own recess and its own parts
    let pocket: { rect: RecessRect; plane: FacePlane; depth: number } | null = null;
    if (frontGrid && decor) {
      const px = frontGrid.pixelMm;
      const zTopElev = H - frontCut;
      const zLo = fz0 + (k === 0 ? frontCut : 0) + px;
      const zHi = fz1 - (k === N - 1 ? frontCut : 0) - px;
      const r0 = Math.ceil((zTopElev - zHi) / px);
      const r1 = Math.floor((zTopElev - zLo) / px);
      if (r1 - r0 >= 1) {
        const slice = sliceRows(frontGrid, r0, r1);
        // the slice's v = 0 sits at this z in the panel's own frame
        const plane: FacePlane = {
          O: [c, 0, zTopElev - r1 * px - fz0],
          U: [1, 0, 0],
          V: [0, 0, 1],
          n: [0, -1, 0],
        };
        const cut = decorateFace(
          "front",
          plane,
          slice,
          frontRecess,
          0,
          input.frontColor,
          (i) =>
            N > 1
              ? `Front ${k + 1} ${i < 0 ? "base" : `decor ${i + 1}`}`
              : `Front ${i < 0 ? "base" : `decor ${i + 1}`}`,
          [0, 0, fz0]
        );
        if (cut) pocket = { rect: cut.rect, plane, depth: cut.depth };
      }
    }
    // the outermost fronts carry the cube's top/bottom chamfer; the middle ones
    // butt against a shelf, so their ends stay square
    const panelLocal = buildDrawerPanel(
      W,
      frontThk,
      fz1 - fz0,
      c,
      grooves,
      k === N - 1,
      k === 0,
      pocket
    );
    const dy = k * (drawerDmm + LAYOUT_GAP);
    // fronts in one column beside the cabinet, their trays in the next column
    const fPos = panelLocal.slice();
    for (let i = 0; i < fPos.length; i += 3) {
      fPos[i] += W + LAYOUT_GAP;
      fPos[i + 1] += dy;
    }
    frontParts.push({
      name: N > 1 ? `Front ${k + 1}` : "Front",
      color: input.frontColor,
      positions: fPos,
    });
    const tPos = trayLocal.slice();
    for (let i = 0; i < tPos.length; i += 3) {
      tPos[i] += 2 * W + 2 * LAYOUT_GAP;
      tPos[i + 1] += dy;
    }
    trayParts.push({
      name: N > 1 ? `Tray ${k + 1}` : "Tray",
      color: input.drawerColor,
      positions: tPos,
    });

    // assembled: the panel *is* the cube's front slab — it sits flush in the
    // front plane (y 0..frontThk) — and the tray slides in behind it, its wall
    // ends flat against the panel's back face, centred by `tx`, sat on the
    // compartment floor.
    const aPos = panelLocal.slice();
    for (let i = 0; i < aPos.length; i += 3) {
      aPos[i + 2] += fz0;
    }
    assembledParts.push({
      name: N > 1 ? `Front ${k + 1}` : "Front",
      color: input.frontColor,
      positions: aPos,
    });
    const aTray = trayLocal.slice();
    for (let i = 0; i < aTray.length; i += 3) {
      aTray[i] += tx;
      aTray[i + 1] += frontThk;
      aTray[i + 2] += pz0 + k * (ch + shelfThk);
    }
    assembledParts.push({
      name: N > 1 ? `Tray ${k + 1}` : "Tray",
      color: input.drawerColor,
      positions: aTray,
    });
  }
  parts.push(...frontParts, ...trayParts, ...decorParts);
  assembledParts.push(...decorGlued);
  // `openMm` is how far the assembled preview slides a drawer forward when it
  // animates them open: most of the tray comes out (so you can see inside), but
  // the back of the tray stays in the cavity so it still reads as one object.
  const assembled = {
    parts: assembledParts,
    openMm: trayD * 0.75,
    ...modelBounds(assembledParts),
  };

  const { bboxMm, centerMm } = modelBounds(parts);
  const triangleCount = parts.reduce((s, p) => s + p.positions.length, 0) / 9;

  // ---- 2D preview: cabinet footprint (walls brighter than the floor) ----
  const preview = new Uint8ClampedArray(n * 4);
  const col = input.color;
  const wallAt = (x: number, y: number): number => {
    // the shell starts `frontThk` behind the front plane (the drawer fronts fill
    // that slab), so the front cross-section is reported right up to the plane
    const sy = Math.max(y, frontThk);
    if (!insideOct(x, sy, W, D, c)) return 0;
    const inCavity = x >= px0 && x <= px1 && sy >= frontThk && sy <= py1;
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

  // ---- decoration warnings ----
  if (decor && decorFaces.length > 0) {
    const clampedShell = decor.faces.some(
      (f) => f !== "front" && wantRecess > shellLimit + 1e-6
    );
    const clampedFront =
      decor.faces.includes("front") && wantRecess > frontRecess + 1e-6;
    if (clampedShell || clampedFront) {
      const used = Math.min(
        clampedShell ? shellLimit : Infinity,
        clampedFront ? frontRecess : Infinity
      );
      warnings.push(
        `A ${wantRecess.toFixed(1)} mm recess is deeper than the material ` +
          `behind the decorated faces allows — clamped to ${used.toFixed(1)} mm ` +
          `(thicken the walls, or lower the recess).`
      );
    }
    if (wantProud > 1e-6 && decor.faces.includes("front")) {
      warnings.push(
        `Drawer-front inlays stay flush (the design's proud ${wantProud.toFixed(
          1
        )} mm is ignored there) so an open drawer cannot catch on a shelf.`
      );
    }
    if (decorThin) {
      warnings.push(
        `Part of the design is thinner than one cell (~${decorCellMm.toFixed(
          2
        )} mm) — those lines will be missing; raise the decoration resolution ` +
          `or simplify the image.`
      );
    }
    if (decorCellMm > 0.8) {
      warnings.push(
        `Decoration cells are ${decorCellMm.toFixed(
          2
        )} mm across — coarse detail reads as steps; raise the decoration ` +
          `resolution or shrink the design.`
      );
    } else if (decorCellMm < 0.12) {
      warnings.push(
        `Decoration cells are only ${decorCellMm.toFixed(
          2
        )} mm across — finer than a nozzle can draw; lower the decoration ` +
          `resolution.`
      );
    }
    warnings.push(...decorWarnings);
  }

  return {
    parts,
    assembled,
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
    decor:
      decorFaces.length > 0
        ? {
            faces: decorFaces,
            partCount: decorParts.length,
            recessMm: decorRecessUsed,
            thicknessMm: decorThicknessUsed,
            cellMm: decorCellMm,
          }
        : undefined,
    warnings,
  };
}

