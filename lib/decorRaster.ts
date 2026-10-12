// Browser-side rasterisation for the Drawers → 3D decoration.
//
// Drawing an <img> and reading its pixels back needs a canvas, so it lives here
// (mirroring `rasterizeBadge` in lib/badge.ts) and hands the pure geometry a
// palette-index grid — see `lib/decor.ts` for everything downstream.

import { EMPTY, mapPixelsToPalette, collectPixels, autoPalette, type RGB } from "./quantize";
import type { DecorDesign } from "./decor";

/** The image drawn at `maxDim` cells across its longer side, aspect kept. */
export interface DesignPixels {
  /** RGBA, row-major (transparent cells keep alpha 0). */
  data: Uint8ClampedArray;
  gw: number;
  gh: number;
}

export function readDesignPixels(img: HTMLImageElement, maxDim: number): DesignPixels {
  const nw = Math.max(1, img.naturalWidth);
  const nh = Math.max(1, img.naturalHeight);
  const scale = Math.min(1, Math.max(8, maxDim) / Math.max(nw, nh));
  const gw = Math.max(1, Math.round(nw * scale));
  const gh = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // draw on a transparent canvas: transparent areas stay transparent, and so
  // become empty space (face material) rather than a colour
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, gw, gh);
  return { data: ctx.getImageData(0, 0, gw, gh).data, gw, gh };
}

/** Auto-detect the design's colours, with the pixel count each one covers. */
export function detectDesignPalette(
  px: DesignPixels,
  count: number
): { palette: RGB[]; counts: number[] } {
  const palette = autoPalette(collectPixels(px.data), count);
  const grid = mapPixelsToPalette(px.data, palette);
  const counts = new Array(palette.length).fill(0);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== EMPTY) counts[grid[i]]++;
  }
  return { palette, counts };
}

/** Map the image's pixels onto palette indices (EMPTY where transparent). */
export function designFromPixels(
  px: DesignPixels,
  palette: RGB[]
): DecorDesign {
  if (palette.length === 0) {
    return { grid: new Uint8Array(px.gw * px.gh).fill(EMPTY), gw: px.gw, gh: px.gh };
  }
  return { grid: mapPixelsToPalette(px.data, palette), gw: px.gw, gh: px.gh };
}

