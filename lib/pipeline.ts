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
  buildShapeClippedGeometry,
  buildSmoothHeightfieldGeometry,
  computeRingMask,
  makeFineShapeGrid,
  quantizeZ,
  type FineShapeGrid,
  type RingSpec,
} from "./mesh";
import {
  classifyPixels,
  makeShapeSilhouette,
  type ShapeParams,
} from "./shapes";
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

/** Copy of `layers` with border pixels (cls === 1) forced to `v`. */
function applyBorderToStack(
  layers: Uint8Array,
  cls: Uint8Array | null,
  v: number
): Uint8Array {
  const out = layers.slice();
  if (cls) {
    for (let i = 0; i < out.length; i++) if (cls[i] === 1) out[i] = v;
  }
  return out;
}

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

  // Smooth silhouette: clip the mesh to the exact shape boundary so edges are
  // true lines/curves instead of a pixel staircase. The fine grid is shared
  // by every part so all parts clip to the same silhouette. Resolution is
  // capped so huge images don't blow up mesh build time.
  const shape = shapeOpts?.shape;
  let fine: FineShapeGrid | null = null;
  if (shape) {
    // Fine cells per pixel edge, capped so huge images stay snappy: the
    // silhouette only needs refinement along its ~1px boundary band, but
    // the fine grid covers the whole plate, so keep total fine cells in
    // check (sub=4 => 16x the per-pixel geometry).
    // Budget the refinement across all colour parts (lithophane is a single
    // part, CMYK has 4, mosaic/layered uses palette.length), so the total
    // triangle count stays in the low millions even at the highest resolutions.
    const parts =
      mode === "lithophane" ? 1 : mode === "cmyk" ? 4 : Math.max(1, palette.length);
    const sub = Math.max(
      1,
      Math.min(
        4,
        Math.floor(Math.sqrt(1_200_000 / (parts * gw * gh)))
      )
    );
    fine = makeFineShapeGrid(makeShapeSilhouette(shape, gw, gh), gw, gh, sub);
  }
  // A pixel contributes material when any of its fine cells is inside the
  // shape — exactly matching the mesh clip, so the silhouette never has
  // notches and boundary slivers always carry a colour/height.
  const pixelIntersects = fine
    ? (x: number, y: number): boolean => {
        const s = fine!.sub;
        const row0 = y * s * fine!.fw + x * s;
        for (let k = 0; k < s * s; k++) {
          if (fine!.inside[row0 + ((k / s) | 0) * fine!.fw + (k % s)]) {
            return true;
          }
        }
        return false;
      }
    : undefined;

  // shape mask / border classification (0 = outside, 1 = border, 2 = inside)
  const borderMm = shapeOpts?.borderMm ?? 0;
  const cls =
    shape || borderMm > 0
      ? classifyPixels(
          gw,
          gh,
          shape ?? { type: "rectangle", cx: 0.5, cy: 0.5, size: 1 },
          borderMm / pixelSize,
          pixelIntersects
        )
      : null;
  // Fine-cell border ring, shared by every part: cells inside the shape
  // within borderMm of its true boundary. This is what the mesh uses (see
  // RingSpec), so the ring reaches exactly out to the smooth silhouette and
  // its inner edge follows the shape's inward offset instead of a pixel
  // staircase.
  const ringMask =
    fine && borderMm > 0
      ? computeRingMask(fine, gw, gh, borderMm / pixelSize)
      : null;
  const buildMesh = (
    z0s: Float32Array,
    z1s: Float32Array,
    useSmooth = smooth,
    ring?: RingSpec | null,
    othersSolid?: Uint8Array | null,
    solidMask?: Uint8Array | null,
    sheetSupport0?: Uint8Array | null,
    sheetSupport1?: Uint8Array | null
  ): number[] =>
    fine
      ? buildShapeClippedGeometry(
          z0s,
          z1s,
          gw,
          gh,
          pixelSize,
          fine,
          useSmooth,
          ring ?? null,
          othersSolid ?? null,
          solidMask ?? null,
          sheetSupport0 ?? null,
          sheetSupport1 ?? null
        )
      : useSmooth
        ? buildSmoothHeightfieldGeometry(
            z0s,
            z1s,
            gw,
            gh,
            pixelSize,
            undefined,
            solidMask ?? null,
            sheetSupport0 ?? null,
            sheetSupport1 ?? null
          )
        : buildHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize);

  // ---- CMYK lithophane: C/M/Y color layers + white relief, 4 parts
  if (mode === "cmyk") {
    const o = cmyk ?? DEFAULT_CMYK;
    const stacks = computeCmykStacks(imageData, o);
    if (cls) {
      for (let i = 0; i < n; i++) {
        const c = cls[i];
        if (c === 0) {
          // outside the shape: no geometry at all
          stacks.c[i] = 0;
          stacks.m[i] = 0;
          stacks.y[i] = 0;
          stacks.w[i] = 0;
        }
      }
    }
    // Preview / metrics keep the pixel-level border ring (full CMY + max
    // white); the mesh gets the ring as fine cells instead (see ringSpec
    // below), so the printed ring reaches exactly out to the silhouette.
    const previewStacks =
      cls && cls.some((c) => c === 1)
        ? {
            c: applyBorderToStack(stacks.c, cls, o.colorLayers),
            m: applyBorderToStack(stacks.m, cls, o.colorLayers),
            y: applyBorderToStack(stacks.y, cls, o.colorLayers),
            w: applyBorderToStack(stacks.w, cls, o.whiteMaxLayers),
          }
        : stacks;
    const lh = Math.max(0.04, layerHeight);

    let maxZ = 0;
    let filled = 0;
    for (let i = 0; i < n; i++) {
      const t =
        (previewStacks.c[i] +
          previewStacks.m[i] +
          previewStacks.y[i] +
          previewStacks.w[i]) *
        lh;
      if (t > 0) filled++;
      if (t > maxZ) maxZ = t;
    }

    const ringPx = borderMm / pixelSize;
    const ringSpec: RingSpec | null = ringMask
      ? { px: ringPx, mask: ringMask, owns: true, othersOwnRing: true, z0: 0, z1: 0 }
      : null;
    // Pixels covered by more than one part (C and M and Y and W overlap on
    // dark pixels): there, the repair may clear a diagonal contact in one
    // part because the others still cover the cell.
    const othersSolid = new Uint8Array(n);
    {
      const matCount = new Uint8Array(n);
      for (const key of ["c", "m", "y", "w"] as const) {
        const layers = stacks[key];
        for (let i = 0; i < n; i++) if (layers[i] > 0) matCount[i]++;
      }
      for (let i = 0; i < n; i++) othersSolid[i] = matCount[i] > 1 ? 1 : 0;
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
    // Shared interface fields. Boundary k (between channel k-1 and k) is ONE
    // height per pixel (bnd[k][i]), so neighbours always agree on where bands
    // start and end. Flat bands pad+lift each channel (loPad/hiPad): touching
    // cells of the SAME part overlap by 2*EPS (a shared face instead of the
    // 4-way point contact a slicer refuses to repair) while consecutive parts
    // meet exactly face-to-face. Smooth sheets CANNOT pad per-part (the two
    // sides would interpolate different fields and interpenetrate by tens of
    // microns), so smooth builds use the exact nominal boundaries with no
    // lift: every sheet is then the same function of the same values, and
    // shared vertices are bitwise identical. Touching cells of the same
    // smooth part meet at exact shared vertices (as the shipped per-pixel
    // smooth builder did) — no fusion overlap, and no shared volume with
    // neighbours either.
    const EPS = 0.001;
    /** Bottom z of stack channel `k` at a band starting at `base`. */
    const loPad = (baseZ: number, k: number): number =>
      baseZ > 1e-9 ? baseZ + EPS * (2 * k - 1) : 0;
    /** Top z of a channel's band [base, base+h] at stack position `k`. */
    const hiPad = (baseZ: number, h: number, k: number): number =>
      baseZ + h + EPS * (2 * k + 1);
    const bnd: Float32Array[] = [];
    {
      const run = new Float32Array(n);
      bnd.push(run.slice());
      for (const key of ["c", "m", "y", "w"] as const) {
        const layers = stacks[key];
        for (let i = 0; i < n; i++) run[i] += layers[i] * lh;
        bnd.push(run.slice());
      }
    }
    // Per-channel material. Smooth sheets share the union of ALL channels as
    // their blend support (any pixel carrying any channel), and every smooth
    // interface shares one universal lift so both sides stay identical.
    const hasLayers = partDefs.map((def) => {
      const layers = stacks[def.key];
      const m = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (layers[i] > 0) m[i] = 1;
      return m;
    });
    const smoothSupport = smooth ? new Uint8Array(n) : null;
    if (smoothSupport) {
      for (let i = 0; i < n; i++) {
        smoothSupport[i] =
          hasLayers[0][i] || hasLayers[1][i] || hasLayers[2][i] || hasLayers[3][i]
            ? 1
            : 0;
      }
    }
    // Smooth bands use the exact nominal shared boundaries (no lift — any
    // per-part pad would differ between the two sides of an interface).
    // Same-part touching cells meet at exact shared vertices (no gaps).
    const zSmooth = (b: number): number => b;
    const meshes: ColorMeshData[] = [];
    partDefs.forEach((def, k) => {
      const ringLayers =
        def.key === "w" ? o.whiteMaxLayers : o.colorLayers;
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (hasLayers[k][i]) count++;
        if (smooth) {
          // Smooth band: exact nominal shared boundaries, so both sides of
          // an interface interpolate the same values.
          z0s[i] = zSmooth(bnd[k][i]);
          z1s[i] = zSmooth(bnd[k + 1][i]);
        } else if (hasLayers[k][i]) {
          // Flat bands use the exact shared, padded boundaries face-to-face.
          z0s[i] = loPad(bnd[k][i], k);
          z1s[i] = hiPad(bnd[k][i], bnd[k + 1][i] - bnd[k][i], k);
        } else {
          z0s[i] = loPad(bnd[k][i], k);
          z1s[i] = loPad(bnd[k][i], k);
        }
      }
      quantizeZ(z0s);
      quantizeZ(z1s);
      if (ringSpec) {
        // The border ring is the same stack as a fully covered pixel: every
        // channel owns its own slice of it (full CMY + max white in total).
        // Flat slices use the padded face-to-face values; smooth slices use
        // the exact nominal boundaries like the interior bands.
        const below = k * o.colorLayers * lh;
        const top = below + ringLayers * lh;
        if (smooth) {
          ringSpec.z0 = zSmooth(below);
          ringSpec.z1 = zSmooth(top);
        } else {
          ringSpec.z0 = below > 1e-9 ? below + EPS * (2 * k - 1) : 0;
          ringSpec.z1 = hiPad(below, ringLayers * lh, k);
        }
      }
      // Smooth: every part blends over the same universal support, so all
      // sheets are the same function of the same interface values. Flat:
      // each part blends over its own pixels only (exact face-to-face
      // boundaries need no cross-part agreement, and wider support would
      // taper the sheet over empty pixels).
      const sup0 = smooth ? smoothSupport! : hasLayers[k];
      const sup1 = smooth ? smoothSupport! : hasLayers[k];
      const solidMask = hasLayers[k];
      meshes.push({
        color: def.color,
        name: def.name,
        pixelCount: count,
        z0: 0,
        z1: maxZ,
        positions: buildMesh(
          z0s,
          z1s,
          smooth,
          ringSpec,
          othersSolid,
          solidMask,
          sup0,
          sup1
        ),
      });
    });

    if (curveDeg > 0.01) {
      let minZ = Infinity;
      for (const m of meshes) {
        minZ = Math.min(minZ, bendPositions(m.positions, widthMm, curveDeg));
      }
      // Every part gets the SAME bed translation (per-part translation would
      // pull stacked bands out of radial alignment) and it is applied
      // unconditionally: the bent plate stands on its bottom edge, so its
      // lowest point must sit at z = 0 — never a fraction of a millimetre
      // above the bed.
      if (isFinite(minZ)) for (const m of meshes) shiftZ(m.positions, -minZ);
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
      cmykPreview: simulateCmykPreview(previewStacks, o),
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
    // The mesh's border ring is applied per fine cell (ringSpec below); the
    // preview keeps the pixel-level ring so the 2D backlit preview shows it.
    let previewHeights = heights;
    if (cls) {
      for (let i = 0; i < n; i++) {
        const c = cls[i];
        if (c === 0) heights[i] = 0;
      }
      if (cls.some((c) => c === 1)) {
        previewHeights = heights.slice();
        for (let i = 0; i < n; i++) if (cls[i] === 1) previewHeights[i] = maxMm;
      }
    }
    let opaque = 0;
    for (let i = 0; i < n; i++) if (previewHeights[i] > 0) opaque++;
    const z0s = new Float32Array(n); // all zero: every column starts at z=0
    const ringPx = borderMm / pixelSize;
    const ringSpec: RingSpec | null = ringMask
      ? { px: ringPx, mask: ringMask, owns: true, othersOwnRing: false, z0: 0, z1: maxMm }
      : null;
    const mesh: ColorMeshData = {
      color: [245, 245, 240],
      name: "Lithophane (white filament)",
      pixelCount: opaque,
      z0: 0,
      z1: maxMm,
      positions: buildMesh(z0s, heights, smooth, ringSpec),
    };
    if (curveDeg > 0.01) {
      const minZ = bendPositions(mesh.positions, widthMm, curveDeg);
      // Re-seat the standing plate: its bottom edge is the z = 0 contact face.
      if (isFinite(minZ)) shiftZ(mesh.positions, -minZ);
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
      heights: previewHeights,
      minThicknessMm: minMm,
      ...boundsFields([mesh]),
    };
  }

  // ---- palette-based modes (mosaic / layered)
  const grid = mapPixelsToPalette(imageData.data, palette);
  if (cls) {
    for (let i = 0; i < n; i++) {
      if (cls[i] === 0) grid[i] = EMPTY;
    }
  }

  // Per-colour diagonal pinch fill: two same-colour cells touching only
  // diagonally leave a four-way point-contact edge in that colour's mesh (the
  // other two cells belong to a different colour or are empty). Bambu Studio
  // refuses such meshes instead of repairing them, and along the silhouette
  // they turn the side wall into a ragged comb — so every diagonal contact
  // must go. Filling one of the two orthogonal cells with the pair's colour
  // is a 1-pixel nudge, invisible at print scale (pixels are ≥ 0.4 mm).
  //
  // This has to run to CONVERGENCE, not a fixed two passes: heavily dithered
  // source art (1-pixel checkerboards — most 8/16-bit game screenshots) is
  // nothing but diagonal contacts, and each fill can expose a fresh one next
  // door. The pass cap only bounds cost; the loop exits as soon as a pass
  // changes nothing, which guarantees a pinch-free grid.
  // Diagonal pinches are resolved before AND after the edge-band pass,
  // since the edge band can itself expose a new diagonal contact.
  const fixPinches = (): void => {
    for (let pass = 0; pass < 64; pass++) {
      let changed = false;
      for (let y = 0; y < gh - 1; y++) {
        for (let x = 0; x < gw - 1; x++) {
          const i = y * gw + x;
          const a = grid[i];
          const b = grid[i + gw + 1];
          if (a !== EMPTY && a === b) {
            const c1 = grid[i + 1];
            const c2 = grid[i + gw];
            if (c1 !== a && c2 !== a) {
              grid[i + 1] = a;
              changed = true;
            }
          } else {
            const a2 = grid[i + 1];
            const b2 = grid[i + gw];
            if (a2 !== EMPTY && a2 === b2) {
              if (grid[i] !== a2 && grid[i + gw + 1] !== a2) {
                grid[i] = a2;
                changed = true;
              }
            }
          }
        }
      }
      if (!changed) break;
    }
  };
  fixPinches();

  // Edge-band dither absorption. Along the silhouette the plate's outer wall
  // shows one colour column per boundary pixel, and each column is only ~1
  // extrusion wide. Runs of one or two columns are unprintable: the wall reads
  // as a shattered barcode, while the same image gives clean solid blocks
  // wherever its dither is coarser (which is why one edge can look fine and a
  // dithered one does not). Each wall line is treated as the 1-D colour
  // sequence it is, and runs shorter than a printable length are absorbed into
  // the neighbouring run, swept in both directions so an alternating dither
  // collapses rather than merely flipping. A pixel keeps its exact print
  // colour wherever its colour spans a printable stretch of the outline;
  // interior pixels are never touched.
  {
    const minRun = Math.max(2, Math.round(1.4 / pixelSize)); // ~1.4 mm of wall
    const at = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= gw || y >= gh ? -1 : y * gw + x;
    const sweep = (vertical: boolean, side: number, forward: boolean): boolean => {
      let changed = false;
      const outer = vertical ? gw : gh;
      const inner = vertical ? gh : gw;
      for (let o = 0; o < outer; o++) {
        const gridAt = (k: number): number =>
          vertical ? grid[at(o, k)] : grid[at(k, o)];
        const isWallAt = (k: number): boolean => {
          const x = vertical ? o : k,
            y = vertical ? k : o;
          return (
            grid[at(x, y)] !== EMPTY &&
            grid[at(vertical ? x + side : x, vertical ? y : y + side)] === EMPTY
          );
        };
        const order: number[] = [];
        for (let k = 0; k < inner; k++) order.push(forward ? k : inner - 1 - k);
        let prevColour = -1;
        let i = 0;
        while (i < order.length) {
          const k0 = order[i];
          if (!isWallAt(k0)) {
            i++;
            continue;
          }
          const c = gridAt(k0);
          let i1 = i;
          while (
            i1 + 1 < order.length &&
            order[i1 + 1] === order[i1] + (forward ? 1 : -1) &&
            isWallAt(order[i1 + 1]) &&
            gridAt(order[i1 + 1]) === c
          ) {
            i1++;
          }
          const len = i1 - i + 1;
          if (len < minRun && prevColour >= 0 && prevColour !== c) {
            for (let q = i; q <= i1; q++)
              grid[vertical ? at(o, order[q]) : at(order[q], o)] = prevColour;
            changed = true;
          } else {
            prevColour = c;
          }
          i = i1 + 1;
        }
      }
      return changed;
    };
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const vertical of [true, false])
        for (const side of [-1, 1])
          for (const forward of [true, false])
            if (sweep(vertical, side, forward)) changed = true;
      if (!changed) break;
    }
  }

  fixPinches();

  const counts = new Array<number>(palette.length).fill(0);
  // Preview / metrics keep the pixel-level border ring (Filament 1, the
  // darkest); the mesh gets the ring as fine cells instead (ringSpec below),
  // so the printed ring reaches exactly out to the silhouette and its inner
  // edge follows the shape instead of a pixel staircase.
  const previewGrid =
    cls && cls.some((c) => c === 1)
      ? (() => {
          const g = grid.slice();
          for (let i = 0; i < n; i++) if (cls[i] === 1) g[i] = 0;
          return g;
        })()
      : grid;
  let filled = 0;
  for (let i = 0; i < n; i++) {
    if (previewGrid[i] !== EMPTY) {
      counts[previewGrid[i]]++;
      filled++;
    }
  }

  const ringPx = borderMm / pixelSize;
  const ringSpecFor = (i: number, z0: number, z1: number): RingSpec | null =>
    ringMask
      ? { px: ringPx, mask: ringMask, owns: i === 0, othersOwnRing: false, z0, z1 }
      : null;
  // Layered bands nest (band i covers every pixel of colour >= i), so for
  // parts above the first, every non-empty pixel is also covered by band 0 —
  // there the repair may clear a diagonal contact. Band 0 only shares pixels
  // of colour >= 1. Mosaic pixels carry exactly one colour, so no clear is
  // ever union-safe there; the repair leaves those zero-volume point
  // contacts alone instead of punching holes along the outline.
  const othersSolidFor = (i: number): Uint8Array | null => {
    if (mode !== "layered" || !cls) return null;
    const out = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (grid[p] === EMPTY) continue;
      out[p] = i === 0 ? (grid[p] >= 1 ? 1 : 0) : 1;
    }
    return out;
  };

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
        positions: buildMesh(
          z0s,
          z1s,
          false,
          ringSpecFor(i, bands[i].z0, bands[i].z1),
          othersSolidFor(i)
        ),
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
        positions: buildMesh(z0s, z1s, false, ringSpecFor(i, 0, depthMm), null),
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
    // One shared bed translation, applied unconditionally: the bent plate
    // stands on its bottom edge (z = 0), never floating above the bed.
    if (isFinite(minZ)) for (const m of meshes) shiftZ(m.positions, -minZ);
  }
  return {
    grid: previewGrid,
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
