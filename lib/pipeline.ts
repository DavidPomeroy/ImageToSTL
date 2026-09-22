// Glue between image data, quantization and mesh generation.
//
// Two print modes:
//  - "mosaic":  every color region is a solid prism from z=0 to z=depth,
//               side by side in XY (flat, uniform thickness).
//  - "layered": HueForge-style stack. Palette index 0 is the bottom filament.
//               Color k covers the Z band [bands[k].z0, bands[k].z1] for every
//               pixel whose palette index is >= k, so each pixel's column stops
//               at the top of its own color's band — the visible top surface of
//               a pixel is printed with its assigned filament, and the plate
//               becomes a variable-height relief.

import { EMPTY, mapPixelsToPalette, rgbToHex, type RGB } from "./quantize";
import {
  buildRects,
  buildRectsForColor,
  meshPositions,
  rectsToBoxes,
  type Box,
} from "./mesh";

export type PrintMode = "mosaic" | "layered";

/** Z range of one color band, plus the 1-based inclusive print layers. */
export interface BandInfo {
  z0: number;
  z1: number;
  layer0: number;
  layer1: number;
}

export interface ColorMeshData {
  color: RGB;
  name: string;
  boxes: Box[];
  pixelCount: number;
  z0: number;
  z1: number;
}

export interface ProcessedImage {
  grid: Uint8Array;
  gw: number;
  gh: number;
  mode: PrintMode;
  layerHeight: number;
  /** Per palette color; in mosaic mode each band is the full 0..depth. */
  bands: BandInfo[];
  meshes: ColorMeshData[];
  widthMm: number;
  heightMm: number;
  /** Effective total height (snapped to whole layers in layered mode). */
  depthMm: number;
  pixelSizeMm: number;
  triangleCount: number;
}

const fmtZ = (n: number): string => String(Number(n.toFixed(2)));

/**
 * Split `depthMm` into `count` color bands snapped to whole multiples of
 * `layerHeight`, as evenly as possible.
 */
export function computeBands(
  count: number,
  depthMm: number,
  layerHeight: number
): BandInfo[] {
  const totalLayers = Math.max(
    count,
    Math.max(1, Math.round(depthMm / layerHeight))
  );
  const bands: BandInfo[] = [];
  for (let k = 0; k < count; k++) {
    const l0 = Math.round((totalLayers * k) / count);
    const l1 = Math.round((totalLayers * (k + 1)) / count);
    bands.push({
      z0: l0 * layerHeight,
      z1: l1 * layerHeight,
      layer0: l0 + 1,
      layer1: l1,
    });
  }
  return bands;
}

/** Draw an uploaded image onto a small canvas and read back the pixels. */
export function downscaleImageData(
  img: HTMLImageElement,
  maxDim: number
): ImageData {
  const scale = Math.min(
    1,
    maxDim / Math.max(img.naturalWidth, img.naturalHeight)
  );
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Draw on a transparent canvas: transparent areas stay transparent and
  // become empty space (no geometry) in the print.
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function processImageData(
  imageData: ImageData,
  palette: RGB[],
  widthMm: number,
  depthMm: number,
  mode: PrintMode = "mosaic",
  layerHeight = 0.2
): ProcessedImage {
  const gw = imageData.width;
  const gh = imageData.height;
  const grid = mapPixelsToPalette(imageData.data, palette);
  const pixelSize = widthMm / gw;

  const counts = new Array<number>(palette.length).fill(0);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== EMPTY) counts[grid[i]]++;
  }

  let bands: BandInfo[];
  let meshes: ColorMeshData[];
  let effectiveDepth = depthMm;

  if (mode === "layered") {
    bands = computeBands(palette.length, depthMm, layerHeight);
    if (bands.length > 0) effectiveDepth = bands[bands.length - 1].z1;
    meshes = palette.map((color, i) => {
      // Band i covers every pixel whose color is i *or higher* in the stack;
      // pixels of color i stop here, so their top face shows filament i.
      const rects = buildRects(grid, gw, gh, (v) => v !== EMPTY && v >= i);
      return {
        color,
        name: `Color ${i + 1} (${rgbToHex(color)}) z ${fmtZ(
          bands[i].z0
        )}-${fmtZ(bands[i].z1)}mm`,
        boxes: rectsToBoxes(rects, gh, pixelSize),
        pixelCount: counts[i],
        z0: bands[i].z0,
        z1: bands[i].z1,
      };
    });
  } else {
    bands = palette.map(() => ({
      z0: 0,
      z1: depthMm,
      layer0: 1,
      layer1: Math.max(1, Math.round(depthMm / layerHeight)),
    }));
    meshes = palette.map((color, i) => ({
      color,
      name: `Color ${i + 1} (${rgbToHex(color)})`,
      boxes: rectsToBoxes(
        buildRectsForColor(grid, gw, gh, i),
        gh,
        pixelSize
      ),
      pixelCount: counts[i],
      z0: 0,
      z1: depthMm,
    }));
  }

  let triangleCount = 0;
  for (const m of meshes) triangleCount += m.boxes.length * 12;

  return {
    grid,
    gw,
    gh,
    mode,
    layerHeight,
    bands,
    meshes,
    widthMm,
    heightMm: gh * pixelSize,
    depthMm: effectiveDepth,
    pixelSizeMm: pixelSize,
    triangleCount,
  };
}

/** Convenience: flat triangle positions for every color part. */
export function meshPartPositions(p: ProcessedImage) {
  return p.meshes.map((m) => ({
    name: m.name,
    color: m.color,
    positions: meshPositions(m.boxes, m.z0, m.z1),
  }));
}
