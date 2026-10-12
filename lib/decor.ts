// Image-driven decoration (inlay) for the Drawers → 3D tool.
//
// An uploaded image is reduced to a grid of palette indices — one cell per print
// pixel — and applied to the faces the user picks. On each face it becomes:
//
//   * a **recess** in the face, spanning the design's own footprint, and
//   * **separate parts**, one per inlaid colour (each printing in its own
//     filament) plus a **background plate** that fills the rest of the recess.
//
// The plate is what makes the inlay read as a silhouette: its holes are exactly
// the design's cells, so every colour drops into a pocket cut to its own
// outline. Printed in the face's own colour the plate disappears into the
// surface and the set glues in flush; with the background left open the recess
// stays a bare dish and the parts sit in it.
//
// Everything here is pure. Rasterising the uploaded image needs a canvas, so it
// lives in the page (mirroring the badge tool's rasterizeBadge /
// buildBadgeFromMasks split) and hands over a palette-index grid.
//
// Why it is all grid-based (no contour tracing, no earcut caps):
//   * earcut drops *collinear* vertices from hole rings, so a cap triangulated
//     from a pixel outline can never weld to walls emitted per outline segment —
//     every straight run leaves a T-junction (a "hole" to the edge tests).
//   * `buildSmoothExtrudedGeometry` (smoothExtrude.ts) triangulates its caps
//     from scanline spans rather than from the contour, so it is not watertight
//     by that measure either (a plain 8×8 block reports 252 unmatched edges).
//   * `buildMaskExtrusion` (mesh.ts) merges face runs to save triangles, which
//     leaves T-junctions against its per-cell walls around a hole in a large
//     plate — exactly the background plate's shape, so `maskPrism` below emits
//     the same solid without the strip optimisation (it is a plain per-cell
//     prism: every cap edge is shared with a neighbour's cap or a wall).
//
//   face 2D frame:  (u, v) = (right, up) seen from OUTSIDE the face, so a
//   design is never mirrored; a point in space is O + u·U + v·V + w·n.
//
//   Image grids run the other way: row 0 is the image's top. `flipRows` converts
//   one to the other, once, inside `faceDecor` — miss it and the design prints
//   upside down (and its parts no longer line up with their recess).

import { EMPTY, type RGB } from "./quantize";

export type V3 = [number, number, number];

/** Append a quad, wound so its normal points along `dir` (outward). */
function pushQuad(out: number[], a: V3, b: V3, c: V3, d: V3, dir: V3): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const dot = nx * dir[0] + ny * dir[1] + nz * dir[2];
  const P: V3[] = dot < 0 ? [a, d, c, b] : [a, b, c, d];
  out.push(P[0][0], P[0][1], P[0][2], P[1][0], P[1][1], P[1][2], P[2][0], P[2][1], P[2][2]);
  out.push(P[0][0], P[0][1], P[0][2], P[2][0], P[2][1], P[2][2], P[3][0], P[3][1], P[3][2]);
}

/**
 * A mask's solid as a plain per-cell prism: one cap quad per set cell and a wall
 * wherever a set cell meets an unset one. Every edge is shared with a
 * neighbour's cap or with a wall by construction, which is what the edge tests
 * (and slicers) need.
 *
 * Deliberately not `buildMaskExtrusion`: that one merges sheet faces by its own
 * break-column rule, which leaves T-junctions against its per-cell walls around
 * a hole in a large plate — the background plate's shape. Merging the caps here
 * runs into the same trap (a merged run's edge has to break wherever any
 * neighbouring row's run or wall ends), so this stays per-cell: predictable and
 * watertight, at roughly 4× the triangles of a merged slab.
 *
 * The result is flat in the design plane: (x, y) = the plane's (u, v), z = the
 * piece's thickness.
 */
export function maskPrism(
  mask: Uint8Array,
  gw: number,
  gh: number,
  px: number,
  z0: number,
  z1: number
): number[] {
  const out: number[] = [];
  const set = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < gw && y < gh && mask[y * gw + x] !== 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!set(x, y)) continue;
      // Shared edges take their coordinates from the *index* on both sides:
      // `x * px + px` is not always bit-identical to `(x + 1) * px`, and a weld
      // that rounds the two sides differently splits every shared edge.
      const u0 = x * px;
      const u1 = (x + 1) * px;
      const v0 = y * px;
      const v1 = (y + 1) * px;
      pushQuad(out, [u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1], [0, 0, 1]);
      pushQuad(out, [u0, v0, z0], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0], [0, 0, -1]);
      if (!set(x + 1, y)) {
        pushQuad(out, [u1, v0, z0], [u1, v1, z0], [u1, v1, z1], [u1, v0, z1], [1, 0, 0]);
      }
      if (!set(x - 1, y)) {
        pushQuad(out, [u0, v0, z0], [u0, v1, z0], [u0, v1, z1], [u0, v0, z1], [-1, 0, 0]);
      }
      if (!set(x, y + 1)) {
        pushQuad(out, [u0, v1, z0], [u1, v1, z0], [u1, v1, z1], [u0, v1, z1], [0, 1, 0]);
      }
      if (!set(x, y - 1)) {
        pushQuad(out, [u0, v0, z0], [u1, v0, z0], [u1, v0, z1], [u0, v0, z1], [0, -1, 0]);
      }
    }
  }
  return out;
}

/** The cube faces a decoration can be applied to. */
export type DecorFace = "front" | "back" | "left" | "right" | "top" | "bottom";

/** Every face, in the order the UI lists them. */
export const DECOR_FACES: readonly DecorFace[] = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
];

/** Display names, shared by the controls and the printed part names. */
export const DECOR_FACE_LABELS: Record<DecorFace, string> = {
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
  top: "Top",
  bottom: "Bottom",
};

/** The uploaded image reduced to a palette-index grid (row-major, EMPTY = hole). */
export interface DecorDesign {
  grid: Uint8Array;
  gw: number;
  gh: number;
}

/** A design laid onto one face at its own physical scale. */
export interface FaceGrid {
  /** Palette index per cell, row-major, `gw` wide; EMPTY = face material. */
  grid: Uint8Array;
  gw: number;
  gh: number;
  /** Cell size (mm). */
  pixelMm: number;
  /** Column / row the design's own top-left cell landed on. */
  ox: number;
  oy: number;
}

/** A face's design plane: a point is O + u·U + v·V + w·n. */
export interface FacePlane {
  O: V3;
  U: V3;
  V: V3;
  /** Outward unit normal. */
  n: V3;
}

/** Everything the page hands the geometry builder. */
export interface DecorInput {
  /** The uploaded image, reduced to palette indices. */
  design: DecorDesign;
  /** Filament colours, one per part. */
  palette: RGB[];
  /** Which palette entries print as parts (false = the face shows through). */
  inlay: boolean[];
  /** Faces the design is applied to. */
  faces: DecorFace[];
  /** Recess depth into the face (mm). */
  recessMm: number;
  /** How far a part stands proud of the face (mm; 0 = flush). */
  proudMm: number;
  /** Glue clearance: parts are inset from the recess walls by this (mm). */
  clearanceMm: number;
  /** Design size, as a fraction of the face's smaller side (0.05..1). */
  sizePct: number;
  /** −1..1 nudge across / up the face (0 = centred). */
  offset: [number, number];
  /** The background plate's colour, or "face" for the face's own colour. */
  background: "face" | RGB;
  /** False leaves the recess open instead of printing a background plate. */
  backgroundInlay: boolean;
}

/** Cells per design blob below this (mm²) are dropped as unprintable specks. */
const MIN_BLOB_MM2 = 0.25;

/** Face-grid cells per side the design is capped to (keeps meshes sane). */
const MAX_CELLS = 400;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * Dimension-free axes of a face's design plane. (U, V, n) is right-handed, so u
 * runs right and v up as seen from outside the face.
 */
export function faceAxes(face: DecorFace): { U: V3; V: V3; n: V3 } {
  switch (face) {
    case "front":
      return { U: [1, 0, 0], V: [0, 0, 1], n: [0, -1, 0] };
    case "back":
      return { U: [-1, 0, 0], V: [0, 0, 1], n: [0, 1, 0] };
    case "left":
      return { U: [0, -1, 0], V: [0, 0, 1], n: [-1, 0, 0] };
    case "right":
      return { U: [0, 1, 0], V: [0, 0, 1], n: [1, 0, 0] };
    case "top":
      return { U: [1, 0, 0], V: [0, 1, 0], n: [0, 0, 1] };
    case "bottom":
      return { U: [1, 0, 0], V: [0, -1, 0], n: [0, 0, -1] };
  }
}

/** A point on the design plane: origin + u·U + v·V, pushed `w` out of the face. */
export function planePoint(p: FacePlane, u: number, v: number, w = 0): V3 {
  return [
    p.O[0] + u * p.U[0] + v * p.V[0] + w * p.n[0],
    p.O[1] + u * p.U[1] + v * p.V[1] + w * p.n[1],
    p.O[2] + u * p.U[2] + v * p.V[2] + w * p.n[2],
  ];
}

/** The 3D direction of a design-plane 2D vector (no normal component). */
export function planeDirection(p: FacePlane, du: number, dv: number): V3 {
  return [
    du * p.U[0] + dv * p.V[0],
    du * p.U[1] + dv * p.V[1],
    du * p.U[2] + dv * p.V[2],
  ];
}


/**
 * Lay the design onto one face: cells sized so the design keeps one physical
 * scale wherever it appears, centred (plus the user's −1..1 offset) with a clear
 * cell on every edge, so the recess can never touch the face outline.
 */
export function layoutFace(
  design: DecorDesign,
  faceWmm: number,
  faceHmm: number,
  sizePct: number,
  offset: [number, number] = [0, 0]
): FaceGrid {
  const w = Math.max(1, faceWmm);
  const h = Math.max(1, faceHmm);
  const dmax = Math.max(1, design.gw, design.gh);
  const fit = clamp(sizePct, 0.05, 1) * Math.min(w, h);
  // requested cell size: the design's longer side spans `fit` mm on the face
  let px = fit / dmax;
  // never so fine that the face grid blows up (leaving room for the margins)
  const pxFloor = Math.sqrt((w * h) / ((MAX_CELLS - 4) * (MAX_CELLS - 4)));
  px = Math.max(px, pxFloor);
  const gw = Math.max(3, Math.floor(w / px));
  const gh = Math.max(3, Math.floor(h / px));
  // a design too coarse for the clear area is shrunk into it (aspect preserved)
  let src: DecorDesign = design;
  if (design.gw > gw - 2 || design.gh > gh - 2) {
    const s = Math.min((gw - 2) / design.gw, (gh - 2) / design.gh);
    const tw = Math.max(1, Math.floor(design.gw * s));
    const th = Math.max(1, Math.floor(design.gh * s));
    src = { grid: resampleGrid(design, tw, th), gw: tw, gh: th };
  }
  const slackX = Math.max(0, gw - src.gw - 2);
  const slackY = Math.max(0, gh - src.gh - 2);
  const ox = 1 + Math.round(slackX * (0.5 + 0.5 * clamp(offset[0], -1, 1)));
  // +offset[1] moves the design up, i.e. toward row 0
  const oy = 1 + Math.round(slackY * (0.5 - 0.5 * clamp(offset[1], -1, 1)));
  const grid = new Uint8Array(gw * gh).fill(EMPTY);
  for (let y = 0; y < src.gh; y++) {
    const gy = oy + y;
    if (gy < 0 || gy >= gh) continue;
    for (let x = 0; x < src.gw; x++) {
      const gx = ox + x;
      if (gx < 0 || gx >= gw) continue;
      grid[gy * gw + gx] = src.grid[y * src.gw + x];
    }
  }
  return { grid, gw, gh, pixelMm: px, ox, oy };
}

/** Nearest-neighbour resample of a design grid (the caller keeps the aspect). */
export function resampleGrid(d: DecorDesign, tw: number, th: number): Uint8Array {
  const out = new Uint8Array(tw * th).fill(EMPTY);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(d.gh - 1, Math.floor(((y + 0.5) * d.gh) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(d.gw - 1, Math.floor(((x + 0.5) * d.gw) / tw));
      out[y * tw + x] = d.grid[sy * d.gw + sx];
    }
  }
  return out;
}

/** Cells below this count are dropped as specks (a mm² threshold → cells). */
export function minBlobCells(pixelMm: number): number {
  return Math.max(1, Math.round(MIN_BLOB_MM2 / Math.max(1e-6, pixelMm * pixelMm)));
}

/** A grid's rows [r0, r1) as their own grid (the front, split per drawer). */
export function sliceRows(fg: FaceGrid, r0: number, r1: number): FaceGrid {
  const y0 = Math.max(0, Math.min(fg.gh, Math.round(r0)));
  const y1 = Math.max(y0, Math.min(fg.gh, Math.round(r1)));
  const gh = y1 - y0;
  const grid = new Uint8Array(fg.gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < fg.gw; x++) {
      grid[y * fg.gw + x] = fg.grid[(y0 + y) * fg.gw + x];
    }
  }
  return { ...fg, grid, gh, oy: fg.oy - y0 };
}

/** Is this grid entry one of the design's inlay colours? */
export function inlaid(index: number, inlay: boolean[]): boolean {
  return index !== EMPTY && inlay[index] === true;
}

/** How many cells are set in a mask. */
export function maskCells(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}


/** Keep only the mask's 4-connected blobs of at least `minCells` cells. */
export function cleanMask(
  mask: Uint8Array,
  gw: number,
  gh: number,
  minCells: number
): Uint8Array {
  const out = new Uint8Array(mask.length);
  if (minCells <= 1) {
    out.set(mask);
    return out;
  }
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    comp.length = 0;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length > 0) {
      const j = stack.pop() as number;
      comp.push(j);
      const x = j % gw;
      const y = (j / gw) | 0;
      if (x > 0 && mask[j - 1] && !seen[j - 1]) {
        seen[j - 1] = 1;
        stack.push(j - 1);
      }
      if (x + 1 < gw && mask[j + 1] && !seen[j + 1]) {
        seen[j + 1] = 1;
        stack.push(j + 1);
      }
      if (y > 0 && mask[j - gw] && !seen[j - gw]) {
        seen[j - gw] = 1;
        stack.push(j - gw);
      }
      if (y + 1 < gh && mask[j + gw] && !seen[j + gw]) {
        seen[j + gw] = 1;
        stack.push(j + gw);
      }
    }
    if (comp.length >= minCells) for (const j of comp) out[j] = 1;
  }
  return out;
}

/** Grow a mask by `k` cells (4-neighbour) — used to open the plate's holes. */
export function dilateCells(
  mask: Uint8Array,
  gw: number,
  gh: number,
  k: number
): Uint8Array {
  let cur = mask;
  for (let s = 0; s < Math.max(0, Math.round(k)); s++) {
    const out = Uint8Array.from(cur);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (cur[i]) continue;
        if (
          (x > 0 && cur[i - 1]) ||
          (x + 1 < gw && cur[i + 1]) ||
          (y > 0 && cur[i - gw]) ||
          (y + 1 < gh && cur[i + gw])
        ) {
          out[i] = 1;
        }
      }
    }
    cur = out;
  }
  return cur;
}

/**
 * Shrink a mask by `k` cells (4-neighbour shape) — the complement of a dilation,
 * so it reuses the same neighbour rule.
 */
export function erodeCells(
  mask: Uint8Array,
  gw: number,
  gh: number,
  k: number
): Uint8Array {
  if (k <= 0) return Uint8Array.from(mask);
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const grown = dilateCells(inv, gw, gh, k);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = grown[i] ? 0 : 1;
  return out;
}

/**
 * Fine-grid factor for the decoration parts: a mask can only be eroded by whole
 * cells, so they are built on a grid fine enough for the glue clearance to be
 * one or two cells (capped so the grid stays small).
 */
export function fineFactor(pixelMm: number, clearanceMm: number): number {
  if (clearanceMm <= 1e-6) return 1;
  return clamp(Math.ceil(pixelMm / Math.max(0.05, clearanceMm / 1.5)), 1, 6);
}

export interface DecorPartMask {
  index: number;
  color: RGB;
  mask: Uint8Array;
}

/** One cleaned mask per inlaid palette colour that actually appears on the face. */
export function colourMasks(
  fg: FaceGrid,
  palette: RGB[],
  inlay: boolean[]
): DecorPartMask[] {
  const minCells = minBlobCells(fg.pixelMm);
  const out: DecorPartMask[] = [];
  for (let i = 0; i < palette.length; i++) {
    if (inlay[i] !== true) continue;
    const raw = new Uint8Array(fg.grid.length);
    let any = false;
    for (let c = 0; c < fg.grid.length; c++) {
      if (fg.grid[c] === i) {
        raw[c] = 1;
        any = true;
      }
    }
    if (!any) continue;
    const mask = cleanMask(raw, fg.gw, fg.gh, minCells);
    if (maskCells(mask) > 0) out.push({ index: i, color: palette[i], mask });
  }
  return out;
}

/** The union of the parts' masks — the footprint the recess has to follow. */
export function unionMask(parts: DecorPartMask[]): Uint8Array {
  const n = parts[0]?.mask.length ?? 0;
  const out = new Uint8Array(n);
  for (const p of parts) {
    for (let i = 0; i < n; i++) if (p.mask[i]) out[i] = 1;
  }
  return out;
}

/** A grid's rows reversed: the design plane's v runs up, image rows run down. */
export function flipRows(fg: FaceGrid): FaceGrid {
  const row = fg.gw;
  const grid = new Uint8Array(row * fg.gh);
  for (let y = 0; y < fg.gh; y++) {
    const from = (fg.gh - 1 - y) * row;
    grid.set(fg.grid.subarray(from, from + row), y * row);
  }
  return { ...fg, grid };
}

/** A cell box (x1/y1 exclusive). */
export interface CellBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The cell box the recess spans: the design's own footprint (which `layoutFace`
 * already keeps a clear cell away from the face grid's edges).
 */
export function designBox(fg: FaceGrid, mask: Uint8Array): CellBox {
  let x0 = fg.gw;
  let y0 = fg.gh;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < fg.gh; y++) {
    for (let x = 0; x < fg.gw; x++) {
      if (!mask[y * fg.gw + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Nearest-neighbour cell upscale of a mask (the background plate's fine grid). */
export function upscaleMask(
  mask: Uint8Array,
  gw: number,
  gh: number,
  sub: number
): Uint8Array {
  if (sub <= 1) return Uint8Array.from(mask);
  const nw = gw * sub;
  const out = new Uint8Array(nw * gh * sub);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!mask[y * gw + x]) continue;
      for (let sy = 0; sy < sub; sy++) {
        const row = (y * sub + sy) * nw + x * sub;
        out.fill(1, row, row + sub);
      }
    }
  }
  return out;
}

/** A recess rectangle in the design plane's mm frame. */
export interface RecessRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** One printable piece of a face's decoration, flat in the design plane. */
export interface DecorPiece {
  name: string;
  color: RGB;
  /** The piece's solid, flat: (x, y) = the plane's (u, v), z = its thickness. */
  soup: number[];
}

/** A face's decoration, ready to mesh. */
export interface FaceDecor {
  /** Where the recess goes (the design's box, opened by the glue clearance). */
  rect: RecessRect;
  /** Recess depth (mm). */
  depthMm: number;
  /** Piece thickness (mm). */
  thicknessMm: number;
  /** The pieces: one per inlaid colour, then the background plate if any. */
  pieces: DecorPiece[];
  /** Glue clearance actually used (mm) — a whole number of cells. */
  gapMm: number;
  /** True when the design has lines thinner than one cell (unprintable). */
  thin: boolean;
}

/**
 * Build one face's decoration: the recess rectangle, one prism per inlaid
 * colour, and — unless the background is left open — the background plate that
 * fills the rest of the recess. The plate's holes are exactly the design's
 * outline (opened by the glue clearance), so every colour drops into a pocket
 * cut to its own shape.
 */
export function faceDecor(
  fg: FaceGrid,
  palette: RGB[],
  inlay: boolean[],
  opts: {
    recessMm: number;
    proudMm: number;
    clearanceMm: number;
    /** The plate's colour, or null to leave the recess open. */
    background: RGB | null;
    /** Names a piece: `index` is the palette index, or −1 for the plate. */
    name: (index: number) => string;
  }
): FaceDecor | null {
  // The design plane's v runs up while an image grid's rows run down, so the
  // grid is flipped once here: the parts, the plate and the recess rectangle all
  // end up in the same frame (an unflipped grid prints the design upside down).
  const up = flipRows(fg);
  const colour = colourMasks(up, palette, inlay);
  if (colour.length === 0) return null;
  const union = unionMask(colour);
  if (maskCells(union) === 0) return null;
  const px = fg.pixelMm;
  const clr = Math.max(0, opts.clearanceMm);
  const box = designBox(up, union);
  const depthMm = Math.max(0, opts.recessMm);
  const proudMm = Math.max(0, opts.proudMm);
  const thicknessMm = Math.max(0.2, depthMm + proudMm - 0.05);
  // The clearance can only be whole cells (a mask erodes cell by cell), so the
  // parts are inset by `gapCells` — 0 is an exact, press-fit inlay.
  const gapCells = clr > 1e-6 ? Math.min(4, Math.round(clr / px)) : 0;
  const pieces: DecorPiece[] = [];
  for (const p of colour) {
    const inset =
      gapCells > 0 ? erodeCells(p.mask, up.gw, up.gh, gapCells) : p.mask;
    const soup = maskPrism(inset, up.gw, up.gh, px, 0, thicknessMm);
    if (soup.length > 0) {
      pieces.push({ name: opts.name(p.index), color: p.color, soup });
    }
  }
  if (pieces.length === 0) return null;
  if (opts.background) {
    // The plate fills the recess box around the design; its holes are the
    // design's own cells, so each colour drops into a pocket cut to its outline.
    const plate = new Uint8Array(up.grid.length);
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) plate[y * up.gw + x] = 1;
    }
    for (let i = 0; i < plate.length; i++) if (union[i]) plate[i] = 0;
    const cleaned = cleanMask(plate, up.gw, up.gh, minBlobCells(px));
    const soup = maskPrism(cleaned, up.gw, up.gh, px, 0, thicknessMm);
    if (soup.length > 0) {
      pieces.push({ name: opts.name(-1), color: opts.background, soup });
    }
  }
  // The recess: the design's box plus a print fit, capped so the rectangle stays
  // clear of the face outline. Same frame as the pieces above, or the inlay
  // would sit outside its own recess.
  const fit = Math.min(Math.max(clr, 0.1), px * 0.4);
  const rect: RecessRect = {
    u0: box.x0 * px - fit,
    u1: box.x1 * px + fit,
    v0: box.y0 * px - fit,
    v1: box.y1 * px + fit,
  };
  if (rect.u1 - rect.u0 < 0.4 || rect.v1 - rect.v0 < 0.4) return null;
  return {
    rect,
    depthMm,
    thicknessMm,
    pieces,
    gapMm: gapCells * px,
    thin: hasThinFeature(union, up.gw, up.gh),
  };
}

/** Move a flat piece into its glued pose in the face (top `proudMm` out of it). */
export function placePart(
  flat: number[],
  plane: FacePlane,
  thicknessMm: number,
  proudMm: number
): number[] {
  const out = new Array<number>(flat.length);
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const p = planePoint(
      plane,
      flat[i],
      flat[i + 1],
      flat[i + 2] - thicknessMm + proudMm
    );
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  return out;
}

/** A copy of a soup moved by (dx, dy, dz) — a piece's slot in the print layout. */
export function shiftSoup(soup: number[], dx: number, dy: number, dz = 0): number[] {
  const out = new Array<number>(soup.length);
  for (let i = 0; i + 2 < soup.length; i += 3) {
    out[i] = soup[i] + dx;
    out[i + 1] = soup[i + 1] + dy;
    out[i + 2] = soup[i + 2] + dz;
  }
  return out;
}

/** Every cell of the mask is on a line one cell wide — unprintable detail. */
export function hasThinFeature(
  mask: Uint8Array,
  gw: number,
  gh: number
): boolean {
  let any = false;
  for (let y = 1; y + 1 < gh; y++) {
    for (let x = 1; x + 1 < gw; x++) {
      const i = y * gw + x;
      if (!mask[i]) continue;
      any = true;
      // a cell with all four neighbours set is inside a line at least 2 wide
      if (mask[i - 1] && mask[i + 1] && mask[i - gw] && mask[i + gw]) return false;
    }
  }
  return any;
}

/** Bounding size (mm) of a flat soup's (x, y) footprint. */
export function soupSize2D(soup: number[]): { w: number; h: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 2 < soup.length; i += 3) {
    x0 = Math.min(x0, soup[i]);
    x1 = Math.max(x1, soup[i]);
    y0 = Math.min(y0, soup[i + 1]);
    y1 = Math.max(y1, soup[i + 1]);
  }
  return soup.length === 0 ? { w: 0, h: 0 } : { w: x1 - x0, h: y1 - y0 };
}

