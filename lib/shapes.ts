// Shape masks and borders for the printed plate.
//
// Shapes are defined in unit space centered at the origin (roughly [-1, 1]),
// with +Y up. Pixel tests convert image pixel coordinates into unit space
// (image row 0 is the top, so world/unit Y is flipped).

export type ShapeType =
  | "rectangle"
  | "square"
  | "triangle"
  | "hexagon"
  | "circle"
  | "heart"
  | "star";

export interface ShapeParams {
  type: ShapeType;
  /** Center x, normalized 0..1 across the image (0 = left). */
  cx: number;
  /** Center y, normalized 0..1 down the image (0 = top). */
  cy: number;
  /** Shape span as a fraction of the image's smaller dimension (0.05..1.5). */
  size: number;
}

/**
 * Explicit polygon vertices (unit space, +Y up, centered) or null for shapes
 * with cheap direct tests (rectangle, circle, square).
 */
export function shapePolygon(type: ShapeType): [number, number][] | null {
  const pts: [number, number][] = [];
  switch (type) {
    case "triangle": {
      // equilateral triangle, point up
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
        pts.push([Math.cos(a), Math.sin(a)]);
      }
      return pts;
    }
    case "hexagon": {
      // regular hexagon, pointy left/right (flat top/bottom)
      for (let k = 0; k < 6; k++) {
        const a = k * (Math.PI / 3);
        pts.push([Math.cos(a), Math.sin(a)]);
      }
      return pts;
    }
    case "star": {
      // regular 5-point star, point up
      for (let k = 0; k < 10; k++) {
        const outer = k % 2 === 0;
        const a = Math.PI / 2 + (k * Math.PI) / 5;
        const r = outer ? 1 : 0.42;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return pts;
    }
    case "heart": {
      // classic parametric heart, scaled to roughly fit [-1, 1]
      let s = 0;
      for (let k = 0; k < 72; k++) {
        const t = (k * 2 * Math.PI) / 72;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y =
          13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t);
        pts.push([x, y]);
        s = Math.max(s, Math.abs(x), Math.abs(y));
      }
      return pts.map(([x, y]) => [x / s, y / s] as [number, number]);
    }
    default:
      return null;
  }
}

/** Even-odd point-in-polygon test. */
function pointInPolygon(
  x: number,
  y: number,
  poly: [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Minimum distance from a point to a polygon's boundary. */
function distanceToPolygon(
  x: number,
  y: number,
  poly: [number, number][]
): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - xi) * dx + (y - yi) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = xi + t * dx - x;
    const py = yi + t * dy - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Classify every pixel of the grid against the shape:
 * 0 = outside the shape (no geometry), 1 = border ring, 2 = inside.
 * Returns null when there is nothing to do (full rectangle, no border).
 */
export function classifyPixels(
  gw: number,
  gh: number,
  shape: ShapeParams,
  borderPx: number
): Uint8Array | null {
  if (shape.type === "rectangle" && borderPx <= 0) return null;
  const out = new Uint8Array(gw * gh);
  const minDim = Math.min(gw, gh);
  const radiusPx = (shape.size * minDim) / 2;
  const cpx = shape.cx * gw;
  const cpy = shape.cy * gh;
  const scaleX = 1 / radiusPx;
  const scaleY = 1 / radiusPx;
  const needPoly = !["rectangle", "circle", "square"].includes(shape.type);
  const poly = needPoly ? shapePolygon(shape.type) : null;

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      // pixel center, image row 0 = top -> unit +Y is up -> flip
      const ux = (x + 0.5 - cpx) * scaleX;
      const uy = -(y + 0.5 - cpy) * scaleY;
      const i = y * gw + x;

      let inside: boolean;
      if (shape.type === "rectangle") {
        inside = true;
      } else if (shape.type === "circle") {
        inside = ux * ux + uy * uy <= 1;
      } else if (shape.type === "square") {
        inside = Math.abs(ux) <= 1 && Math.abs(uy) <= 1;
      } else {
        inside = pointInPolygon(ux, uy, poly!);
      }
      if (!inside) {
        out[i] = 0;
        continue;
      }

      if (borderPx > 0) {
        let d: number; // distance to the shape boundary, in pixels
        if (shape.type === "circle") {
          d = Math.abs(1 - Math.sqrt(ux * ux + uy * uy)) * radiusPx;
        } else if (shape.type === "square") {
          d = Math.min(1 - Math.abs(ux), 1 - Math.abs(uy)) * radiusPx;
        } else if (shape.type === "rectangle") {
          // border = frame around the image edges
          d = Math.min(x, y, gw - 1 - x, gh - 1 - y);
        } else {
          d = distanceToPolygon(ux, uy, poly!) * radiusPx;
        }
        if (d <= borderPx) {
          out[i] = 1;
          continue;
        }
      }
      out[i] = 2;
    }
  }

  // Remove diagonal pinches: two solid cells touching only diagonally would
  // leave a non-manifold edge in the mesh. Fill one of the two orthogonal
  // empty cells with the pair's class (preferring border) — a 1-pixel nudge
  // that is invisible at print scale.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        const i = y * gw + x;
        const a = out[i];
        const b = out[i + gw + 1];
        if (a > 0 && b > 0 && out[i + 1] === 0 && out[i + gw] === 0) {
          out[i + 1] = Math.min(a, b);
        } else {
          const a2 = out[i + 1];
          const b2 = out[i + gw];
          if (
            a2 > 0 &&
            b2 > 0 &&
            out[i] === 0 &&
            out[i + gw + 1] === 0
          ) {
            out[i] = Math.min(a2, b2);
          }
        }
      }
    }
  }

  return out;
}

/**
 * Unit-space polygon vertices for drawing the shape outline in previews,
 * sampled at the given resolution (for circle-ish shapes like heart).
 */
export function shapeOutlinePoints(
  type: ShapeType,
  samples = 128
): [number, number][] {
  const poly = shapePolygon(type);
  if (poly) return poly;
  if (type === "circle") {
    const pts: [number, number][] = [];
    for (let k = 0; k < samples; k++) {
      const a = (k * 2 * Math.PI) / samples;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }
  // square / rectangle
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
}
