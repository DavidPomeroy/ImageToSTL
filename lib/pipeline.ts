// Glue between image data, quantization and mesh generation.
//
// Three print modes:
//  - "mosaic":     every color region is a solid prism from z=0 to z=depth,
//                  side by side in XY (flat, uniform thickness).
//  - "layered":    HueForge-style stack. Palette index 0 is the bottom
//                  filament. Color k covers the Z band [bands[k].z0,
//                  bands[k].z1] for every pixel whose palette index is >= k,
//                  so each pixel's column stops at the top of its own color's
//                  band — a variable-height relief.
//  - "lithophane": single filament. Each pixel's thickness encodes its
//                  brightness (dark = thick, bright = thin), snapped to whole
//                  print layers. Backlit, the image appears.

import {
  EMPTY,
  luminance,
  mapPixelsToPalette,
  rgbToHex,
  type RGB,
} from "./quantize";
import {
  buildLithophaneGeometry,
  buildStackedGeometry,
  buildRects,
  buildRectsForColor,
  meshPositions,
  rectsToBoxes,
  type Box,
} from "./mesh";

export type PrintMode = "mosaic" | "layered" | "lithophane" | "cmyk";

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
  /** Precomputed triangle soup (lithophane: per-pixel heights). */
  positions?: number[];
  /** Region count when it differs from boxes.length (precomputed geometry). */
  boxCount?: number;
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
  /** Effective max height (snapped to whole layers in layered/lithophane). */
  depthMm: number;
  pixelSizeMm: number;
  triangleCount: number;
  /** Lithophane: per-pixel thickness in mm (0 = empty). */
  heights?: Float32Array;
  /** Lithophane: effective min thickness after layer snapping. */
  minThicknessMm?: number;
  /** CMYK lithophane: simulated backlit appearance (RGBA, 0 alpha = empty). */
  cmykPreview?: Uint8ClampedArray;
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

/**
 * Lithophane height map: brightness → thickness, snapped to whole layers.
 * Dark pixels get max thickness, bright pixels min thickness.
 * Transparent pixels get 0 (= no geometry).
 */
export function computeHeights(
  imageData: ImageData,
  minThickness: number,
  maxThickness: number,
  layerHeight: number
): { heights: Float32Array; minMm: number; maxMm: number } {
  const n = imageData.width * imageData.height;
  const heights = new Float32Array(n);
  const lh = Math.max(0.04, layerHeight);
  const min = Math.max(lh, Math.round(minThickness / lh) * lh);
  const max = Math.max(min, Math.round(maxThickness / lh) * lh);
  const range = max - min;
  const d = imageData.data;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] < 128) continue; // stays 0 = empty
    const lum = luminance([d[o], d[o + 1], d[o + 2]]) / 255; // 0 dark .. 1 bright
    const h = min + (1 - lum) * range;
    heights[i] = Math.min(max, Math.max(min, Math.round(h / lh) * lh));
  }
  return { heights, minMm: min, maxMm: max };
}

// ---------------------------------------------------------------- CMYK

/** CMYK lithophane tuning, in print layers (multiplied by layer height). */
export interface CmykOptions {
  /** Max print layers of each C/M/Y channel per pixel. */
  colorLayers: number;
  /** White layers on the brightest pixels. */
  whiteMinLayers: number;
  /** White layers on the darkest pixels. */
  whiteMaxLayers: number;
}

export const DEFAULT_CMYK: CmykOptions = {
  colorLayers: 4,
  whiteMinLayers: 2,
  whiteMaxLayers: 16,
};

export interface CmykStacks {
  c: Uint8Array;
  m: Uint8Array;
  y: Uint8Array;
  w: Uint8Array;
}

/**
 * Per-pixel layer counts for a CMYK lithophane. Subtractive model: cyan
 * filament absorbs red, magenta absorbs green, yellow absorbs blue — so each
 * channel's thickness is proportional to how much of its complement the
 * pixel's color needs. White thickness encodes overall brightness
 * (dark pixel → thick white).
 */
export function computeCmykStacks(
  imageData: ImageData,
  opts: CmykOptions
): CmykStacks {
  const n = imageData.width * imageData.height;
  const c = new Uint8Array(n);
  const m = new Uint8Array(n);
  const y = new Uint8Array(n);
  const w = new Uint8Array(n);
  const d = imageData.data;
  const wRange = Math.max(0, opts.whiteMaxLayers - opts.whiteMinLayers);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] < 128) continue; // all 0 = empty
    c[i] = Math.round((1 - d[o] / 255) * opts.colorLayers);
    m[i] = Math.round((1 - d[o + 1] / 255) * opts.colorLayers);
    y[i] = Math.round((1 - d[o + 2] / 255) * opts.colorLayers);
    const lum = luminance([d[o], d[o + 1], d[o + 2]]) / 255;
    w[i] = opts.whiteMinLayers + Math.round((1 - lum) * wRange);
  }
  return { c, m, y, w };
}

/**
 * Approximate backlit appearance of the CMYK stack, for the 2D preview.
 * Returns RGBA (alpha 0 = empty).
 */
export function simulateCmykPreview(
  stacks: CmykStacks,
  opts: CmykOptions
): Uint8ClampedArray {
  const n = stacks.c.length;
  const out = new Uint8ClampedArray(n * 4);
  const cMax = Math.max(1, opts.colorLayers);
  const wRange = Math.max(1, opts.whiteMaxLayers - opts.whiteMinLayers);
  for (let i = 0; i < n; i++) {
    if (stacks.w[i] === 0 && stacks.c[i] + stacks.m[i] + stacks.y[i] === 0)
      continue;
    // white relief attenuates overall brightness
    const bw = 1 - 0.75 * ((stacks.w[i] - opts.whiteMinLayers) / wRange);
    // each color layer absorbs its complement (max 90% absorption)
    const o = i * 4;
    out[o] = Math.round(255 * (1 - 0.9 * (stacks.c[i] / cMax)) * bw);
    out[o + 1] = Math.round(255 * (1 - 0.9 * (stacks.m[i] / cMax)) * bw);
    out[o + 2] = Math.round(255 * (1 - 0.9 * (stacks.y[i] / cMax)) * bw);
    out[o + 3] = 255;
  }
  return out;
}

export function processImageData(
  imageData: ImageData,
  palette: RGB[],
  widthMm: number,
  depthMm: number,
  mode: PrintMode = "mosaic",
  layerHeight = 0.2,
  minThickness = 0.8,
  cmyk?: CmykOptions
): ProcessedImage {
  const gw = imageData.width;
  const gh = imageData.height;
  const pixelSize = widthMm / gw;

  // ---- CMYK lithophane: C/M/Y color layers + white relief, 4 parts
  if (mode === "cmyk") {
    const o = cmyk ?? DEFAULT_CMYK;
    const stacks = computeCmykStacks(imageData, o);
    const lh = Math.max(0.04, layerHeight);
    const n = gw * gh;

    // total height per pixel -> overall max
    let maxZ = 0;
    for (let i = 0; i < n; i++) {
      const t = (stacks.c[i] + stacks.m[i] + stacks.y[i] + stacks.w[i]) * lh;
      if (t > maxZ) maxZ = t;
    }

    const partDefs = [
      { key: "c" as const, name: "Cyan (bottom)", color: [0, 174, 239] as RGB },
      { key: "m" as const, name: "Magenta", color: [236, 0, 140] as RGB },
      { key: "y" as const, name: "Yellow", color: [255, 242, 0] as RGB },
      {
        key: "w" as const,
        name: "White (lithophane, top)",
        color: [245, 245, 240] as RGB,
      },
    ];

    const z0 = new Float32Array(n);
    const z1 = new Float32Array(n);
    const base = new Float32Array(n); // z where the current part starts
    const meshes: ColorMeshData[] = [];
    for (const def of partDefs) {
      const layers = stacks[def.key];
      let count = 0;
      for (let i = 0; i < n; i++) {
        z0[i] = base[i];
        z1[i] = base[i] + layers[i] * lh;
        base[i] = z1[i];
        if (layers[i] > 0) count++;
      }
      const geo = buildStackedGeometry(z0, z1, gw, gh, pixelSize);
      meshes.push({
        color: def.color,
        name: def.name,
        boxes: [],
        pixelCount: count,
        z0: 0,
        z1: maxZ,
        positions: geo.positions,
        boxCount: geo.boxCount,
      });
    }

    return {
      grid: new Uint8Array(n).fill(EMPTY), // preview uses `cmykPreview`
      gw,
      gh,
      mode,
      layerHeight,
      bands: [],
      meshes,
      widthMm,
      heightMm: gh * pixelSize,
      depthMm: maxZ,
      pixelSizeMm: pixelSize,
      triangleCount:
        meshes.reduce((sum, mm) => sum + (mm.positions?.length ?? 0), 0) / 9,
      cmykPreview: simulateCmykPreview(stacks, o),
    };
  }

  // ---- lithophane: one part, per-pixel thickness, no palette needed
  if (mode === "lithophane") {
    const { heights, minMm, maxMm } = computeHeights(
      imageData,
      minThickness,
      depthMm,
      layerHeight
    );
    const geo = buildLithophaneGeometry(heights, gw, gh, pixelSize);
    let opaque = 0;
    for (let i = 0; i < heights.length; i++) if (heights[i] > 0) opaque++;
    const mesh: ColorMeshData = {
      color: [245, 245, 240],
      name: "Lithophane (white filament)",
      boxes: [],
      pixelCount: opaque,
      z0: 0,
      z1: maxMm,
      positions: geo.positions,
      boxCount: geo.boxCount,
    };
    return {
      grid: new Uint8Array(gw * gh).fill(EMPTY), // preview uses `heights`
      gw,
      gh,
      mode,
      layerHeight,
      bands: [],
      meshes: [mesh],
      widthMm,
      heightMm: gh * pixelSize,
      depthMm: maxMm,
      pixelSizeMm: pixelSize,
      triangleCount: geo.positions.length / 9,
      heights,
      minThicknessMm: minMm,
    };
  }

  // ---- palette-based modes (mosaic / layered)
  const grid = mapPixelsToPalette(imageData.data, palette);

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
      boxes: rectsToBoxes(buildRectsForColor(grid, gw, gh, i), gh, pixelSize),
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

/** Convenience: flat triangle positions for every part. */
export function meshPartPositions(p: ProcessedImage) {
  return p.meshes.map((m) => ({
    name: m.name,
    color: m.color,
    positions: m.positions ?? meshPositions(m.boxes, m.z0, m.z1),
  }));
}
