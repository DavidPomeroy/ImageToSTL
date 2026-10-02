// Coaster geometry: a round / hexagonal / octagonal / rounded-square / square
// coaster built from an uploaded image. Two modes share the same base plate:
//   - "mosaic": a solid base (the rim colour) with the quantized image colours
//     raised on top inside the rim.
//   - "relief": a single-filament relief — a raised rim with the image engraved
//     (bright = high) in the well.
// The mascot shapes are rasterized with a canvas (lib/masks.ts); the geometry
// is pure and reuses the shared meshers.

import { buildHeightfieldGeometry, buildMaskExtrusion, type TriangleSoup } from "./mesh";
import { modelBounds } from "./bounds";
import { coasterShapeMask, erodeMask, type CoasterShape } from "./masks";
import { chamferToZero } from "./textSign";
import { EMPTY, luminance, mapPixelsToPalette, type RGB } from "./quantize";

export interface CoasterInput {
  shape: CoasterShape;
  /** Overall width / diameter (mm). */
  sizeMm: number;
  /** Base plate thickness (mm). */
  baseMm: number;
  /** Rim band width (mm). */
  rimMm: number;
  /** Rounded-square corner radius (mm). */
  cornerMm: number;
  mode: "mosaic" | "relief";
  /** Height of the colours (mosaic) / depth of the rim relief (mm). */
  depthMm: number;
  /** Grid resolution (px across). */
  resolution: number;
  baseColor: RGB;
  palette: RGB[];
  reliefInvert: boolean;
}

export interface CoasterPart {
  name: string;
  color: RGB;
  z0: number;
  z1: number;
  positions: TriangleSoup;
}

/**
 * Relief heights snap to this many steps inside the well.
 *
 * The heightfield mesher splits every wall at every distinct z level in the
 * part, so a continuous per-pixel relief (one z per cell) explodes into
 * millions of triangles — the browser then chokes on the preview. Snapping to
 * a fixed number of steps keeps the mesh small (a handful of z levels) exactly
 * like the terrain's layer snapping, and the steps are far finer than a nozzle
 * can print anyway.
 */
export const RELIEF_LEVELS = 24;

export interface CoasterResult {
  parts: CoasterPart[];
  mode: "mosaic" | "relief";
  gw: number;
  gh: number;
  pixelSizeMm: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  triangleCount: number;
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  /** Mosaic: per-cell palette index (EMPTY = transparent). */
  grid: Uint8Array;
  palette: RGB[];
  /** Relief: per-cell relief height in mm (mosaic mode leaves this undefined). */
  relief?: Float32Array;
  warnings: string[];
}

/**
 * Build a coaster from an already-quantized grid + shape mask (pure / testable).
 * `grid` has one palette index per cell; `imageData` supplies relief luminance.
 */
export function buildCoasterFromGrid(
  grid: Uint8Array,
  imageData: { data: Uint8ClampedArray },
  shapeMask: Uint8Array,
  gw: number,
  gh: number,
  pixelSize: number,
  input: CoasterInput
): CoasterResult {
  const n = gw * gh;
  const parts: CoasterPart[] = [];
  const warnings: string[] = [];
  const top = input.baseMm + input.depthMm;

  let relief: Float32Array | undefined;

  if (input.mode === "mosaic") {
    // Solid shaped base plate (also the visible rim) with the colours on top.
    const base = buildMaskExtrusion(shapeMask, gw, gh, pixelSize, 0, input.baseMm);
    if (base.length)
      parts.push({
        name: "Base",
        color: input.baseColor,
        z0: 0,
        z1: input.baseMm,
        positions: base,
      });
    const rimPx = input.rimMm / pixelSize;
    const inner = rimPx > 0 ? erodeMask(shapeMask, gw, gh, rimPx) : shapeMask;
    for (let c = 0; c < input.palette.length; c++) {
      const m = new Uint8Array(n);
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (inner[i] && grid[i] === c) {
          m[i] = 1;
          count++;
        }
      }
      if (count === 0) continue;
      const positions = buildMaskExtrusion(
        m,
        gw,
        gh,
        pixelSize,
        input.baseMm,
        top
      );
      if (positions.length)
        parts.push({
          name: `Colour ${c + 1}`,
          color: input.palette[c],
          z0: input.baseMm,
          z1: top,
          positions,
        });
    }
  } else {
    // Relief: raised rim + engraved image in the well, one heightfield part.
    const rimPx = input.rimMm / pixelSize;
    const dist = chamferToZero(shapeMask, gw, gh);
    const z0 = new Float32Array(n);
    const z1 = new Float32Array(n);
    relief = new Float32Array(n);
    const d = imageData.data;
    for (let i = 0; i < n; i++) {
      if (!shapeMask[i]) {
        z1[i] = 0;
        continue;
      }
      let h: number;
      if (dist[i] <= rimPx + 0.5) {
        h = input.depthMm; // rim at full depth
      } else {
        const o = i * 4;
        let lum = luminance([d[o], d[o + 1], d[o + 2]]) / 255;
        if (input.reliefInvert) lum = 1 - lum;
        // engraved depth = 0 … 60% of the rim height, snapped to whole steps
        const step = (input.depthMm * 0.6) / RELIEF_LEVELS;
        h = Math.round((input.depthMm * (0.15 + 0.85 * lum) * 0.6) / step) * step;
      }
      relief[i] = h;
      z1[i] = input.baseMm + h;
    }
    const positions = buildHeightfieldGeometry(z0, z1, gw, gh, pixelSize);
    parts.push({
      name: "Coaster (relief)",
      color: input.baseColor,
      z0: 0,
      z1: top,
      positions,
    });
  }

  const { bboxMm, centerMm } = modelBounds(parts);
  const triangleCount = parts.reduce((s, p) => s + p.positions.length, 0) / 9;
  if (parts.length <= 1 && input.mode === "mosaic")
    warnings.push("No colours detected — try more colours or a different image.");

  return {
    parts,
    mode: input.mode,
    gw,
    gh,
    pixelSizeMm: pixelSize,
    widthMm: gw * pixelSize,
    heightMm: gh * pixelSize,
    depthMm: top,
    triangleCount,
    bboxMm,
    centerMm,
    grid,
    palette: input.palette,
    relief,
    warnings,
  };
}

/** Browser entry point: rasterize the shape, quantize the image, build. */
export function buildCoaster(
  imageData: ImageData,
  input: CoasterInput
): CoasterResult {
  const gw = imageData.width;
  const gh = imageData.height;
  const pixelSize = input.sizeMm / Math.max(gw, gh);
  const shapeMask = coasterShapeMask(
    input.shape,
    gw,
    gh,
    input.cornerMm / pixelSize
  );
  const grid = mapPixelsToPalette(imageData.data, input.palette);
  // Transparent pixels fall back to the base colour (no coloured prism).
  for (let i = 0; i < grid.length; i++) {
    if (imageData.data[i * 4 + 3] < 128) grid[i] = EMPTY;
  }
  return buildCoasterFromGrid(grid, imageData, shapeMask, gw, gh, pixelSize, input);
}
