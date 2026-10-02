// Terrain geometry: turn a normalized elevation grid (0..1 per cell) into a
// solid, slicer-ready model. Every cell is a column from z = 0 (a solid base +
// edge "skirt") up to base + elevation, built with the shared manifold
// heightfield mesher. Two sources feed the same core:
//   - an uploaded heightmap image (luminance → elevation), or
//   - real elevation tiles fetched from the map picker.

import { buildHeightfieldGeometry, type TriangleSoup } from "./mesh";
import { luminance, type RGB } from "./quantize";
import { modelBounds } from "./bounds";

export interface TerrainPart {
  name: string;
  color: RGB;
  z0: number;
  z1: number;
  positions: TriangleSoup;
}

export interface TerrainFrame {
  /** How far the base plate extends beyond the relief footprint (mm). */
  widthMm: number;
  color: RGB;
}

export interface TerrainOpts {
  /** Printed width of the terrain footprint (mm). */
  widthMm: number;
  /** Crest height above the base (mm). */
  reliefMm: number;
  /** Solid base thickness (mm). */
  baseMm: number;
  /** Snap all heights to whole layers (0 = no snapping). */
  layerHeight: number;
  /** Elevation fraction flattened to a "water" plane (0..1). */
  seaLevelNorm: number;
  /** Single-colour terrain colour (also the fallback band colour). */
  color: RGB;
  /** 1 = single colour; >1 = stepped contour bands (multi-colour). */
  bands: number;
  /** Band colours, low → high (length >= bands). */
  bandColors: RGB[];
  /** Optional raised rectangular frame (own part/colour). */
  frame: TerrainFrame | null;
}

export interface TerrainResult {
  parts: TerrainPart[];
  gw: number;
  gh: number;
  pixelSizeMm: number;
  widthMm: number;
  heightMm: number;
  maxHeightMm: number;
  triangleCount: number;
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  /** Post-sea-level elevation, 0..1 per cell (for the 2D preview). */
  norm: Float32Array;
  warnings: string[];
}

function snap(v: number, lh: number): number {
  return lh > 0 ? Math.round(v / lh) * lh : v;
}

function translate(positions: number[], dx: number, dy: number): void {
  // Vertex layout is [x, y, z]. X lives at indices 0,3,6…; Y at 1,4,7…
  if (dx !== 0) for (let i = 0; i < positions.length; i += 3) positions[i] += dx;
  if (dy !== 0) for (let i = 1; i < positions.length; i += 3) positions[i] += dy;
}

/**
 * Bilinear terrain surface height (model Z, mm) at a model point, using the
 * same formula as `buildTerrainFromHeights` (sea level, layer snap and stepped
 * bands). Used to ground things like OSM buildings on the terrain.
 */
export function makeGroundSampler(
  normIn: Float32Array,
  gw: number,
  gh: number,
  pixelSize: number,
  opts: TerrainOpts
): (xMm: number, yMm: number) => number {
  const sea = Math.max(0, Math.min(0.95, opts.seaLevelNorm));
  const bands = Math.max(1, Math.floor(opts.bands));
  const at = (x: number, y: number): number => {
    const xi = x < 0 ? 0 : x > gw - 1 ? gw - 1 : x;
    const yi = y < 0 ? 0 : y > gh - 1 ? gh - 1 : y;
    return normIn[yi * gw + xi];
  };
  const surface = (nm: number): number => {
    const v = nm < sea ? sea : nm > 1 ? 1 : nm;
    if (bands <= 1)
      return snap(opts.baseMm + v * opts.reliefMm, opts.layerHeight);
    const level = Math.min(bands - 1, Math.floor(v * bands));
    return snap(
      opts.baseMm + ((level + 1) / bands) * opts.reliefMm,
      opts.layerHeight
    );
  };
  return (xMm: number, yMm: number): number => {
    // cell centres sit at (x+0.5)*s; grid row 0 is the top (max Y).
    const fx = xMm / pixelSize - 0.5;
    const fy = gh - yMm / pixelSize - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const v00 = at(x0, y0);
    const v10 = at(x0 + 1, y0);
    const v01 = at(x0, y0 + 1);
    const v11 = at(x0 + 1, y0 + 1);
    const top = v00 + (v10 - v00) * tx;
    const bot = v01 + (v11 - v01) * tx;
    return surface(top + (bot - top) * ty);
  };
}


export function buildTerrainFromHeights(
  normIn: Float32Array,
  gw: number,
  gh: number,
  opts: TerrainOpts
): TerrainResult {
  const warnings: string[] = [];
  const pixelSize = opts.widthMm / gw;
  const n = gw * gh;

  // Sea level: flatten everything below the threshold (a solid "water" plane).
  const sea = Math.max(0, Math.min(0.95, opts.seaLevelNorm));
  const norm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = normIn[i];
    norm[i] = v < sea ? sea : v > 1 ? 1 : v;
  }

  const bands = Math.max(1, Math.floor(opts.bands));
  const parts: TerrainPart[] = [];

  // When a base plate (frame) is present the relief sits on top of it, so the
  // terrain columns start at the plate's top (baseMm) instead of z = 0. This
  // keeps the plate a solid, hole-free slab (manifold) rather than a ring.
  const zBase = opts.frame && opts.frame.widthMm > 0 ? opts.baseMm : 0;

  if (bands <= 1) {
    const z0s = new Float32Array(n);
    const z1s = new Float32Array(n);
    if (zBase > 0) z0s.fill(zBase);
    for (let i = 0; i < n; i++) {
      z1s[i] = snap(opts.baseMm + norm[i] * opts.reliefMm, opts.layerHeight);
    }
    parts.push({
      name: "Terrain",
      color: opts.color,
      z0: 0,
      z1: opts.baseMm + opts.reliefMm,
      positions: buildHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize),
    });
  } else {
    // Stepped contour bands: quantize elevation to `bands` flat plateaus and
    // nest them (band j is solid where level >= j) so each colour is a slab.
    const level = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      level[i] = Math.min(bands - 1, Math.floor(norm[i] * bands));
    }
    for (let j = 0; j < bands; j++) {
      const z0s = new Float32Array(n);
      const z1s = new Float32Array(n);
      if (zBase > 0) z0s.fill(zBase);
      let used = 0;
      for (let i = 0; i < n; i++) {
        if (level[i] >= j) {
          z1s[i] = snap(
            opts.baseMm + ((j + 1) / bands) * opts.reliefMm,
            opts.layerHeight
          );
          used++;
        }
      }
      if (used === 0) continue;
      parts.push({
        name: `Elevation ${j + 1}/${bands}`,
        color: opts.bandColors[j] ?? opts.color,
        z0: 0,
        z1: opts.baseMm + ((j + 1) / bands) * opts.reliefMm,
        positions: buildHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize),
      });
    }
  }

  if (opts.frame && opts.frame.widthMm > 0) {
    const plate = buildPlate(gw, gh, pixelSize, opts);
    if (plate) parts.push(plate);
  }

  const { bboxMm, centerMm } = modelBounds(parts);
  let maxHeightMm = 0;
  for (const p of parts) if (p.z1 > maxHeightMm) maxHeightMm = p.z1;
  const triangleCount =
    parts.reduce((s, p) => s + p.positions.length, 0) / 9;

  if (n > 0 && pixelSize < 0.4) {
    warnings.push(
      `Cell size ${pixelSize.toFixed(2)} mm is below a typical 0.4 mm nozzle — ` +
        `lower the resolution or widen the tile.`
    );
  }

  return {
    parts,
    gw,
    gh,
    pixelSizeMm: pixelSize,
    widthMm: opts.widthMm,
    heightMm: gh * pixelSize,
    maxHeightMm,
    triangleCount,
    bboxMm,
    centerMm,
    norm,
    warnings,
  };
}

/**
 * Full rectangular base plate (the "frame"): a solid slab that extends
 * `widthMm` beyond the relief footprint. Because every cell is solid it is a
 * simple heightfield — fully manifold (a ring with an empty interior would
 * leave unstitched concave corners). The relief is built on top of it.
 */
function buildPlate(
  gw: number,
  gh: number,
  pixelSize: number,
  opts: TerrainOpts
): TerrainPart | null {
  const f = opts.frame;
  if (!f) return null;
  const fw = Math.max(1, Math.round(f.widthMm / pixelSize));
  const FW = gw + 2 * fw;
  const FH = gh + 2 * fw;
  const z0 = new Float32Array(FW * FH);
  const z1 = new Float32Array(FW * FH);
  const top = snap(opts.baseMm, opts.layerHeight);
  z1.fill(top);
  const positions = buildHeightfieldGeometry(z0, z1, FW, FH, pixelSize);
  translate(positions, -fw * pixelSize, -fw * pixelSize);
  return { name: "Base plate", color: f.color, z0: 0, z1: top, positions };
}

/**
 * Uploaded-image adapter: brightness → elevation. Dark = low, bright = high
 * (or the reverse with `invert`). `autoLevel` stretches the map to its real
 * min/max. Transparent pixels are flat (base only, no holes).
 */
export function normFromImage(
  imageData: ImageData,
  opts: { invert: boolean; autoLevel: boolean }
): { norm: Float32Array; gw: number; gh: number } {
  const n = imageData.width * imageData.height;
  const raw = new Float32Array(n);
  const d = imageData.data;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] < 128) {
      raw[i] = 0;
      continue;
    }
    let v = luminance([d[o], d[o + 1], d[o + 2]]) / 255; // 0 dark .. 1 bright
    if (opts.invert) v = 1 - v;
    raw[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const norm = new Float32Array(n);
  if (opts.autoLevel && isFinite(lo) && hi > lo) {
    const range = hi - lo;
    for (let i = 0; i < n; i++) {
      norm[i] = d[i * 4 + 3] < 128 ? 0 : (raw[i] - lo) / range;
    }
  } else {
    norm.set(raw);
  }
  return { norm, gw: imageData.width, gh: imageData.height };
}

/** Map adapter: real metres → normalized elevation (0..1 across min..max). */
export function normFromElevations(
  elevations: Float32Array,
  minM: number,
  maxM: number
): Float32Array {
  const n = elevations.length;
  const out = new Float32Array(n);
  const range = maxM - minM;
  for (let i = 0; i < n; i++) {
    out[i] = range > 1e-6 ? (elevations[i] - minM) / range : 0;
  }
  return out;
}
