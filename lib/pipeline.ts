// Glue between image data, quantization and mesh generation.
//
// All meshes are built as per-pixel heightfields (lib/mesh.ts), which emit
// only boundary faces — manifold geometry, no non-manifold edges from
// coincident internal box faces.
//
// Print modes:
//  - "mosaic":     every color region is solid from z=0 to z=depth, side by
//                  side in XY (flat, uniform thickness).
//  - "layered":    HueForge-style stack. Palette index 0 is the bottom
//                  filament. Color k covers the Z band [bands[k].z0,
//                  bands[k].z1] for every pixel whose palette index is >= k,
//                  so each pixel's column stops at the top of its own color's
//                  band — a variable-height relief.
//  - "lithophane": single filament. Each pixel's thickness encodes its
//                  brightness (dark = thick, bright = thin), snapped to whole
//                  print layers. Backlit, the image appears.
//  - "cmyk":       CMYK lithophane. Thin C/M/Y layers at the bottom mix
//                  subtractively for color; a white relief on top controls
//                  brightness. Four stacked parts.

import {
  EMPTY,
  luminance,
  mapPixelsToPalette,
  rgbToHex,
  type RGB,
} from "./quantize";
import {
  buildHeightfieldGeometry,
  buildSmoothHeightfieldGeometry,
} from "./mesh";
import { classifyPixels, type ShapeParams } from "./shapes";
import { bendPositions, shiftZ } from "./curve";

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
  /** Pixels covered by this part (layered: band coverage, i.e. >= this color). */
  pixelCount: number;
  z0: number;
  z1: number;
  /** Flat triangle soup: 9 numbers per triangle. */
  positions: number[];
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
  /** Non-empty pixel count (transparent pixels are empty space). */
  filledPixels: number;
  widthMm: number;
  heightMm: number;
  /** Effective max height (snapped to whole layers in layered/lithophane/cmyk). */
  depthMm: number;
  pixelSizeMm: number;
  triangleCount: number;
  /** Lithophane: per-pixel thickness in mm (0 = empty). */
  heights?: Float32Array;
  /** Lithophane: effective min thickness after layer snapping. */
  minThicknessMm?: number;
  /** CMYK lithophane: simulated backlit appearance (RGBA, 0 alpha = empty). */
  cmykPreview?: Uint8ClampedArray;
  /** Bounding-box extents after curvature (mm). */
  bboxMm: { x: number; y: number; z: number };
  /** Model-space center of the combined solid (mm), for view fitting. */
  centerMm: { x: number; y: number };
}

const fmtZ = (n: number): string => String(Number(n.toFixed(2)));

function meshBounds(meshes: ColorMeshData[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i],
        y = m.positions[i + 1],
        z = m.positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function boundsFields(meshes: ColorMeshData[]) {
  const bb = meshBounds(meshes);
  return {
    bboxMm: {
      x: bb.maxX - bb.minX,
      y: bb.maxY - bb.minY,
      z: bb.maxZ - bb.minZ,
    },
    centerMm: {
      x: (bb.minX + bb.maxX) / 2,
      y: (bb.minY + bb.maxY) / 2,
    },
  };
}

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
  cmyk?: CmykOptions,
  smooth = false,
  shapeOpts?: { shape?: ShapeParams; borderMm?: number },
  curveDeg = 0
): ProcessedImage {
  const gw = imageData.width;
  const gh = imageData.height;
  const n = gw * gh;
  const pixelSize = widthMm / gw;

  // shape mask / border classification (0 = outside, 1 = border, 2 = inside)
  const shape = shapeOpts?.shape;
  const borderMm = shapeOpts?.borderMm ?? 0;
  const cls =
    shape || borderMm > 0
      ? classifyPixels(
          gw,
          gh,
          shape ?? { type: "rectangle", cx: 0.5, cy: 0.5, size: 1 },
          borderMm / pixelSize
        )
      : null;

  // ---- CMYK lithophane: C/M/Y color layers + white relief, 4 parts
  if (mode === "cmyk") {
    const o = cmyk ?? DEFAULT_CMYK;
    const stacks = computeCmykStacks(imageData, o);
    if (cls) {
      for (let i = 0; i < n; i++) {
        const c = cls[i];
        if (c === 0) {
          stacks.c[i] = 0;
          stacks.m[i] = 0;
          stacks.y[i] = 0;
          stacks.w[i] = 0;
        } else if (c === 1) {
          // border: full CMY + max white -> solid dark frame backlit
          stacks.c[i] = o.colorLayers;
          stacks.m[i] = o.colorLayers;
          stacks.y[i] = o.colorLayers;
          stacks.w[i] = o.whiteMaxLayers;
        }
      }
    }
    const lh = Math.max(0.04, layerHeight);

    let maxZ = 0;
    let filled = 0;
    for (let i = 0; i < n; i++) {
      const t = (stacks.c[i] + stacks.m[i] + stacks.y[i] + stacks.w[i]) * lh;
      if (t > 0) filled++;
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

    const z0s = new Float32Array(n);
    const z1s = new Float32Array(n);
    const base = new Float32Array(n); // z where the current part starts
    // Extend each band by a micron so adjacent pixels whose bands merely
    // touch (one ends where the other starts) overlap slightly — this keeps
    // each part manifold instead of leaving a point-contact pinch edge.
    const EPS = 0.001;
    const meshes: ColorMeshData[] = [];
    for (const def of partDefs) {
      const layers = stacks[def.key];
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (layers[i] > 0) {
          z0s[i] = Math.max(0, base[i] - EPS);
          z1s[i] = base[i] + layers[i] * lh + EPS;
          count++;
        } else {
          z0s[i] = 0;
          z1s[i] = 0;
        }
        base[i] += layers[i] * lh;
      }
      meshes.push({
        color: def.color,
        name: def.name,
        pixelCount: count,
        z0: 0,
        z1: maxZ,
        positions: smooth
          ? buildSmoothHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize)
          : buildHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize),
      });
    }

    if (curveDeg > 0.01) {
      let minZ = Infinity;
      for (const m of meshes) {
        minZ = Math.min(minZ, bendPositions(m.positions, widthMm, curveDeg));
      }
      if (minZ < 0) for (const m of meshes) shiftZ(m.positions, -minZ);
    }
    return {
      grid: new Uint8Array(n).fill(EMPTY), // preview uses `cmykPreview`
      gw,
      gh,
      mode,
      layerHeight,
      bands: [],
      meshes,
      filledPixels: filled,
      widthMm,
      heightMm: gh * pixelSize,
      depthMm: maxZ,
      pixelSizeMm: pixelSize,
      triangleCount: meshes.reduce((sum, mm) => sum + mm.positions.length, 0) / 9,
      cmykPreview: simulateCmykPreview(stacks, o),
      ...boundsFields(meshes),
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
    if (cls) {
      for (let i = 0; i < n; i++) {
        const c = cls[i];
        if (c === 0) heights[i] = 0;
        else if (c === 1) heights[i] = maxMm; // border: thickest = darkest
      }
    }
    let opaque = 0;
    for (let i = 0; i < n; i++) if (heights[i] > 0) opaque++;
    const z0s = new Float32Array(n); // all zero: every column starts at z=0
    const mesh: ColorMeshData = {
      color: [245, 245, 240],
      name: "Lithophane (white filament)",
      pixelCount: opaque,
      z0: 0,
      z1: maxMm,
      positions: smooth
        ? buildSmoothHeightfieldGeometry(z0s, heights, gw, gh, pixelSize)
        : buildHeightfieldGeometry(z0s, heights, gw, gh, pixelSize),
    };
    if (curveDeg > 0.01) {
      const minZ = bendPositions(mesh.positions, widthMm, curveDeg);
      if (minZ < 0) shiftZ(mesh.positions, -minZ);
    }
    return {
      grid: new Uint8Array(n).fill(EMPTY), // preview uses `heights`
      gw,
      gh,
      mode,
      layerHeight,
      bands: [],
      meshes: [mesh],
      filledPixels: opaque,
      widthMm,
      heightMm: gh * pixelSize,
      depthMm: maxMm,
      pixelSizeMm: pixelSize,
      triangleCount: mesh.positions.length / 9,
      heights,
      minThicknessMm: minMm,
      ...boundsFields([mesh]),
    };
  }

  // ---- palette-based modes (mosaic / layered)
  const grid = mapPixelsToPalette(imageData.data, palette);
  if (cls) {
    for (let i = 0; i < n; i++) {
      const c = cls[i];
      if (c === 0) grid[i] = EMPTY;
      else if (c === 1) grid[i] = 0; // border: Filament 1 (darkest)
    }
  }

  // Per-color diagonal pinch fill: two same-colour cells touching only
  // diagonally leave a non-manifold edge in that colour's mesh (the other
  // two cells belong to different colours or are empty). Fill one of them
  // with the pair's colour — a 1-pixel nudge, invisible at print scale.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        const i = y * gw + x;
        const a = grid[i];
        const b = grid[i + gw + 1];
        if (a !== EMPTY && a === b) {
          const c1 = grid[i + 1];
          const c2 = grid[i + gw];
          if (c1 !== a && c2 !== a) grid[i + 1] = a;
        } else {
          const a2 = grid[i + 1];
          const b2 = grid[i + gw];
          if (a2 !== EMPTY && a2 === b2) {
            if (grid[i] !== a2 && grid[i + gw + 1] !== a2) grid[i] = a2;
          }
        }
      }
    }
  }

  const counts = new Array<number>(palette.length).fill(0);
  let filled = 0;
  for (let i = 0; i < n; i++) {
    if (grid[i] !== EMPTY) {
      counts[grid[i]]++;
      filled++;
    }
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
      const z0s = new Float32Array(n);
      const z1s = new Float32Array(n);
      let count = 0;
      for (let p = 0; p < n; p++) {
        if (grid[p] !== EMPTY && grid[p] >= i) {
          z0s[p] = bands[i].z0;
          z1s[p] = bands[i].z1;
          count++;
        }
      }
      return {
        color,
        name: `Color ${i + 1} (${rgbToHex(color)}) z ${fmtZ(
          bands[i].z0
        )}-${fmtZ(bands[i].z1)}mm`,
        pixelCount: count,
        z0: bands[i].z0,
        z1: bands[i].z1,
        positions: buildHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize),
      };
    });
  } else {
    bands = palette.map(() => ({
      z0: 0,
      z1: depthMm,
      layer0: 1,
      layer1: Math.max(1, Math.round(depthMm / layerHeight)),
    }));
    meshes = palette.map((color, i) => {
      const z0s = new Float32Array(n);
      const z1s = new Float32Array(n);
      let count = 0;
      for (let p = 0; p < n; p++) {
        if (grid[p] === i) {
          z1s[p] = depthMm;
          count++;
        }
      }
      return {
        color,
        name: `Color ${i + 1} (${rgbToHex(color)})`,
        pixelCount: count,
        z0: 0,
        z1: depthMm,
        positions: buildHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize),
      };
    });
  }

  const triangleCount =
    meshes.reduce((sum, m) => sum + m.positions.length, 0) / 9;

  if (curveDeg > 0.01) {
    let minZ = Infinity;
    for (const m of meshes) {
      minZ = Math.min(minZ, bendPositions(m.positions, widthMm, curveDeg));
    }
    if (minZ < 0) for (const m of meshes) shiftZ(m.positions, -minZ);
  }
  return {
    grid,
    gw,
    gh,
    mode,
    layerHeight,
    bands,
    meshes,
    filledPixels: filled,
    widthMm,
    heightMm: gh * pixelSize,
    depthMm: effectiveDepth,
    pixelSizeMm: pixelSize,
    triangleCount,
    ...boundsFields(meshes),
  };
}

/** Convenience: flat triangle positions for every part. */
export function meshPartPositions(p: ProcessedImage) {
  return p.meshes.map((m) => ({
    name: m.name,
    color: m.color,
    positions: m.positions,
  }));
}
