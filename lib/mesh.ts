// Turn a palette-indexed pixel grid into extruded box geometry.
// Adjacent same-color pixels are merged into rectangles first, which keeps
// the triangle count (and slicer load) far below one-box-per-pixel.

export interface MergedRect {
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number; // inclusive
}

/** Axis-aligned box in millimetres, extruded from z=0 to z=depth. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Extract the regions of one color as merged rectangles:
 * horizontal runs are merged, then identical runs on consecutive rows
 * are extended vertically.
 */
export function buildRectsForColor(
  grid: Uint8Array,
  w: number,
  h: number,
  colorIdx: number
): MergedRect[] {
  const rects: MergedRect[] = [];
  let active = new Map<string, MergedRect>();

  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    const next = new Map<string, MergedRect>();
    let x = 0;
    while (x < w) {
      if (grid[rowOff + x] === colorIdx) {
        const x0 = x;
        while (x < w && grid[rowOff + x] === colorIdx) x++;
        const x1 = x - 1;
        const key = x0 + "-" + x1;
        const prev = active.get(key);
        if (prev) {
          prev.y1 = y;
          next.set(key, prev);
        } else {
          next.set(key, { x0, y0: y, x1, y1: y });
        }
      } else {
        x++;
      }
    }
    for (const [key, r] of active) {
      if (!next.has(key)) rects.push(r);
    }
    active = next;
  }
  for (const r of active.values()) rects.push(r);
  return rects;
}

/**
 * Convert pixel-space rects to millimetre boxes.
 * Image row 0 (top) maps to maximum Y so the plate isn't mirrored.
 */
export function rectsToBoxes(
  rects: MergedRect[],
  gridH: number,
  pixelSize: number
): Box[] {
  return rects.map((r) => ({
    x: r.x0 * pixelSize,
    y: (gridH - 1 - r.y1) * pixelSize,
    w: (r.x1 - r.x0 + 1) * pixelSize,
    h: (r.y1 - r.y0 + 1) * pixelSize,
  }));
}

/** Append 12 triangles (36 vertices, non-indexed, CCW outward) for a box. */
export function pushBoxTriangles(
  out: number[],
  b: Box,
  depth: number
): void {
  const x0 = b.x,
    y0 = b.y,
    x1 = b.x + b.w,
    y1 = b.y + b.h,
    z0 = 0,
    z1 = depth;
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const tris = [
    [0, 2, 1],
    [0, 3, 2], // bottom (-Z)
    [4, 5, 6],
    [4, 6, 7], // top (+Z)
    [0, 1, 5],
    [0, 5, 4], // front (-Y)
    [3, 7, 6],
    [3, 6, 2], // back (+Y)
    [0, 4, 7],
    [0, 7, 3], // left (-X)
    [1, 2, 6],
    [1, 6, 5], // right (+X)
  ];
  for (const t of tris) {
    for (const i of t) {
      const p = v[i];
      out.push(p[0], p[1], p[2]);
    }
  }
}

/** Flat triangle soup: 9 numbers per triangle. */
export function meshPositions(boxes: Box[], depth: number): number[] {
  const out: number[] = [];
  for (const b of boxes) pushBoxTriangles(out, b, depth);
  return out;
}
