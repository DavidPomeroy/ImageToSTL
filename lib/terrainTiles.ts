// Elevation tiles from the AWS Open Data "Terrain Tiles" dataset
// (Mapzen/joerd, terrarium PNGs). Keyless, CORS-enabled
// (Access-Control-Allow-Origin: *), so the whole thing runs in the browser.
//
// Decode: elevation_metres = (R*256 + G + B/256) - 32768.

import {
  TILE_SIZE,
  gridForBbox,
  groundSizeMeters,
  latToTileY,
  lngToTileX,
  tileRangeForBbox,
  zoomForTargetPixels,
  type BBox,
} from "./geo";

export interface ElevationRaster {
  /** Elevation in metres, row-major (gw * gh). */
  elevations: Float32Array;
  gw: number;
  gh: number;
  minM: number;
  maxM: number;
  groundWidthM: number;
  groundHeightM: number;
  zoom: number;
  tileCount: number;
  /** Per-tile imagery source names (for attribution). */
  sources: string[];
}

/** Max tiles fetched for a single selection (keeps the request tight). */
export const MAX_TILES = 48;

/**
 * Native fetch size for the elevation raster. Keeping this fixed decouples the
 * tile download from the display grid, so changing the print resolution never
 * refetches tiles — the cached raster is simply resampled locally.
 */
export const NATIVE_PX = 256;

const TILE_BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** Terrarium PNG decode → elevation in metres. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function terrariumUrl(z: number, x: number, y: number): string {
  return `${TILE_BASE}/${z}/${x}/${y}.png`;
}

/**
 * Bilinear resample of a source raster window [x0,y0]..[x1,y1] into a
 * dw x dh grid. Pure, so it is unit-tested without a browser.
 */
export function resampleBilinear(
  src: Float32Array,
  sw: number,
  sh: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dw: number,
  dh: number
): Float32Array {
  const out = new Float32Array(dw * dh);
  const w = Math.max(1e-6, x1 - x0);
  const h = Math.max(1e-6, y1 - y0);
  const clampI = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let j = 0; j < dh; j++) {
    const sy = y0 + ((j + 0.5) / dh) * h - 0.5;
    const y0i = Math.floor(sy);
    const fy = sy - y0i;
    const ya = clampI(y0i, sh - 1);
    const yb = clampI(y0i + 1, sh - 1);
    for (let i = 0; i < dw; i++) {
      const sx = x0 + ((i + 0.5) / dw) * w - 0.5;
      const x0i = Math.floor(sx);
      const fx = sx - x0i;
      const xa = clampI(x0i, sw - 1);
      const xb = clampI(x0i + 1, sw - 1);
      const v00 = src[ya * sw + xa];
      const v10 = src[ya * sw + xb];
      const v01 = src[yb * sw + xa];
      const v11 = src[yb * sw + xb];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      out[j * dw + i] = top + (bot - top) * fy;
    }
  }
  return out;
}

/** Bilinear resample of a whole raster to a new grid size. */
export function resampleElevations(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Float32Array {
  return resampleBilinear(src, sw, sh, 0, 0, sw, sh, dw, dh);
}

interface DecodedTile {
  data: Float32Array;
  sources: string[];
}

/** Fetch + decode one terrarium tile. Missing tiles / network errors → null. */
async function loadTile(
  z: number,
  x: number,
  y: number
): Promise<DecodedTile | null> {
  let res: Response;
  try {
    res = await fetch(terrariumUrl(z, x, y), { mode: "cors" });
  } catch {
    return null; // network/CORS failure — treated as empty water
  }
  if (!res.ok) return null; // 404 = open ocean / not covered

  const sources = (res.headers.get("x-amz-meta-x-imagery-sources") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;

  const data = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0, o = 0; i < data.length; i++, o += 4) {
    data[i] = decodeTerrarium(img[o], img[o + 1], img[o + 2]);
  }
  return { data, sources };
}

/**
 * Download the elevation raster for a bbox, cropped to the bbox and resampled
 * to the print grid. Throws when the selection needs too many tiles.
 */
export async function fetchElevationRaster(
  bbox: BBox,
  targetPx: number
): Promise<ElevationRaster> {
  const z = zoomForTargetPixels(bbox, targetPx);
  const range = tileRangeForBbox(bbox, z);
  const tileCount = range.nx * range.ny;
  if (tileCount > MAX_TILES) {
    throw new Error(
      `This selection needs ${tileCount} map tiles (limit ${MAX_TILES}). ` +
        `Zoom in or choose a smaller area.`
    );
  }

  const sw = range.nx * TILE_SIZE;
  const sh = range.ny * TILE_SIZE;
  const full = new Float32Array(sw * sh);
  const sources = new Set<string>();

  const jobs: Promise<void>[] = [];
  for (let ty = 0; ty < range.ny; ty++) {
    for (let tx = 0; tx < range.nx; tx++) {
      const zx = range.x0 + tx;
      const zy = range.y0 + ty;
      jobs.push(
        loadTile(z, zx, zy).then((tile) => {
          if (!tile) return;
          const cellX = tx * TILE_SIZE;
          const cellY = ty * TILE_SIZE;
          for (let cy = 0; cy < TILE_SIZE; cy++) {
            const rowDst = (cellY + cy) * sw + cellX;
            const rowSrc = cy * TILE_SIZE;
            for (let cx = 0; cx < TILE_SIZE; cx++) {
              full[rowDst + cx] = tile.data[rowSrc + cx];
            }
          }
          for (const s of tile.sources) sources.add(s);
        })
      );
    }
  }
  await Promise.all(jobs);

  // Pixel window of the exact bbox inside the stitched raster.
  const originX = range.x0 * TILE_SIZE;
  const originY = range.y0 * TILE_SIZE;
  const pxW = lngToTileX(bbox.west, z) * TILE_SIZE - originX;
  const pxE = lngToTileX(bbox.east, z) * TILE_SIZE - originX;
  const pxN = latToTileY(bbox.north, z) * TILE_SIZE - originY;
  const pxS = latToTileY(bbox.south, z) * TILE_SIZE - originY;

  const { gw, gh } = gridForBbox(bbox, targetPx);
  const elevations = resampleBilinear(full, sw, sh, pxW, pxN, pxE, pxS, gw, gh);

  let minM = Infinity;
  let maxM = -Infinity;
  for (let i = 0; i < elevations.length; i++) {
    const v = elevations[i];
    if (v < minM) minM = v;
    if (v > maxM) maxM = v;
  }
  if (!isFinite(minM)) {
    minM = 0;
    maxM = 0;
  }

  const { widthM, heightM } = groundSizeMeters(bbox);
  return {
    elevations,
    gw,
    gh,
    minM,
    maxM,
    groundWidthM: widthM,
    groundHeightM: heightM,
    zoom: z,
    tileCount,
    sources: [...sources].sort(),
  };
}

