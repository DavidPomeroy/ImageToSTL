// Glue between image data, quantization and mesh generation.

import {
  EMPTY,
  mapPixelsToPalette,
  rgbToHex,
  type RGB,
} from "./quantize";
import {
  buildRectsForColor,
  meshPositions,
  rectsToBoxes,
  type Box,
} from "./mesh";

export interface ColorMeshData {
  color: RGB;
  name: string;
  boxes: Box[];
  pixelCount: number;
}

export interface ProcessedImage {
  grid: Uint8Array;
  gw: number;
  gh: number;
  meshes: ColorMeshData[];
  widthMm: number;
  heightMm: number;
  depthMm: number;
  pixelSizeMm: number;
  triangleCount: number;
}

/** Draw an uploaded image onto a small canvas and read back the pixels. */
export function downscaleImageData(
  img: HTMLImageElement,
  maxDim: number
): ImageData {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
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
  depthMm: number
): ProcessedImage {
  const gw = imageData.width;
  const gh = imageData.height;
  const grid = mapPixelsToPalette(imageData.data, palette);
  const pixelSize = widthMm / gw;

  const counts = new Array<number>(palette.length).fill(0);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== EMPTY) counts[grid[i]]++;
  }

  const meshes: ColorMeshData[] = palette.map((color, i) => {
    const rects = buildRectsForColor(grid, gw, gh, i);
    return {
      color,
      name: `Color ${i + 1} (${rgbToHex(color)})`,
      boxes: rectsToBoxes(rects, gh, pixelSize),
      pixelCount: counts[i],
    };
  });

  let triangleCount = 0;
  for (const m of meshes) triangleCount += m.boxes.length * 12;

  return {
    grid,
    gw,
    gh,
    meshes,
    widthMm,
    heightMm: gh * pixelSize,
    depthMm,
    pixelSizeMm: pixelSize,
    triangleCount,
  };
}

/** Convenience: flat triangle positions for every color part. */
export function meshPartPositions(p: ProcessedImage) {
  return p.meshes.map((m) => ({
    name: m.name,
    color: m.color,
    positions: meshPositions(m.boxes, p.depthMm),
  }));
}
