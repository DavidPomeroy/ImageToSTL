// Canvas-based shape masks + small binary-mask ops, shared by the badge and
// coaster tools. Rasterization needs an offscreen canvas (browser only); the
// mask operations (erode / and / clear circle) are pure.

import { chamferToZero } from "./textSign";
import { shapeOutlinePoints } from "./shapes";

export type BadgeShape =
  | "rounded"
  | "square"
  | "circle"
  | "hexagon"
  | "dogtag"
  | "heart"
  | "star";

export type CoasterShape =
  | "circle"
  | "hexagon"
  | "octagon"
  | "rounded"
  | "square";

/** Draw a filled path and read back a binary inside mask (1 = inside). */
export function fillMask(
  gw: number,
  gh: number,
  build: (ctx: CanvasRenderingContext2D) => void
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  build(ctx);
  const data = ctx.getImageData(0, 0, gw, gh).data;
  const mask = new Uint8Array(gw * gh);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  return mask;
}

function rounded(
  ctx: CanvasRenderingContext2D,
  gw: number,
  gh: number,
  r: number
): void {
  const rr = Math.max(0, Math.min(r, Math.min(gw, gh) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(0, 0, gw, gh, rr);
  else ctx.rect(0, 0, gw, gh);
  ctx.fill();
}

function ellipse(ctx: CanvasRenderingContext2D, gw: number, gh: number): void {
  ctx.beginPath();
  ctx.ellipse(gw / 2, gh / 2, gw / 2, gh / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function regular(
  ctx: CanvasRenderingContext2D,
  gw: number,
  gh: number,
  n: number,
  rot: number
): void {
  const cx = gw / 2;
  const cy = gh / 2;
  const r = (Math.min(gw, gh) / 2) * 0.995;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function pointPath(
  ctx: CanvasRenderingContext2D,
  gw: number,
  gh: number,
  pts: [number, number][]
): void {
  ctx.beginPath();
  pts.forEach(([u, v], i) => {
    const x = ((u + 1) / 2) * gw;
    const y = (1 - (v + 1) / 2) * gh;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

/** Badge plate silhouette (fills the whole grid). */
export function badgeShapeMask(
  shape: BadgeShape,
  gw: number,
  gh: number,
  radiusPx: number
): Uint8Array {
  return fillMask(gw, gh, (ctx) => {
    switch (shape) {
      case "circle":
        ellipse(ctx, gw, gh);
        break;
      case "square":
        rounded(ctx, gw, gh, 0);
        break;
      case "dogtag":
        rounded(ctx, gw, gh, Math.min(gw, gh) * 0.28);
        break;
      case "hexagon":
        regular(ctx, gw, gh, 6, -Math.PI / 2);
        break;
      case "heart":
        pointPath(ctx, gw, gh, shapeOutlinePoints("heart"));
        break;
      case "star":
        pointPath(ctx, gw, gh, shapeOutlinePoints("star"));
        break;
      default:
        rounded(ctx, gw, gh, radiusPx);
    }
  });
}

/** Coaster silhouette (fills the whole grid). */
export function coasterShapeMask(
  shape: CoasterShape,
  gw: number,
  gh: number,
  radiusPx: number
): Uint8Array {
  return fillMask(gw, gh, (ctx) => {
    switch (shape) {
      case "circle":
        ellipse(ctx, gw, gh);
        break;
      case "hexagon":
        regular(ctx, gw, gh, 6, 0);
        break;
      case "octagon":
        regular(ctx, gw, gh, 8, Math.PI / 8);
        break;
      case "square":
        rounded(ctx, gw, gh, 0);
        break;
      default:
        rounded(ctx, gw, gh, radiusPx);
    }
  });
}

/** Erode a mask by rPx (keep cells farther than rPx from the edge). */
export function erodeMask(
  mask: Uint8Array,
  gw: number,
  gh: number,
  rPx: number
): Uint8Array {
  const out = new Uint8Array(mask.length);
  if (rPx <= 0) {
    out.set(mask);
    return out;
  }
  const d = chamferToZero(mask, gw, gh);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] && d[i] > rPx ? 1 : 0;
  return out;
}

export function andMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && b[i] ? 1 : 0;
  return out;
}

/**
 * Centre (in pixel-centre coordinates) of the widest run of material on row `y`,
 * searching x within [x0, x1]. Lets the keyring hole aim at a lobe instead of a
 * concave top (heart). Returns the middle of the range if the row is empty.
 */
export function runCentre(
  mask: Uint8Array,
  gw: number,
  gh: number,
  y: number,
  x0: number,
  x1: number
): number {
  const yy = Math.max(0, Math.min(gh - 1, y));
  const a = Math.max(0, Math.min(gw - 1, x0));
  const b = Math.max(a, Math.min(gw - 1, x1));
  let bestW = 0;
  let bestC = (a + b + 1) / 2;
  let run = 0;
  let start = a;
  for (let x = a; x <= b; x++) {
    if (mask[yy * gw + x]) {
      if (run === 0) start = x;
      run++;
      if (run > bestW) {
        bestW = run;
        bestC = start + run / 2;
      }
    } else {
      run = 0;
    }
  }
  return bestC;
}

/**
 * Nudge a hole centre straight down until a disc of radius `rPx` (plus `gapPx`
 * of material) fits inside the shape. Without this, shapes whose top edge is
 * concave or pointy (heart, star) would get no hole at all — the disc would
 * fall outside the material. Falls back to the requested spot.
 * Returns [x, y] in pixel-centre coordinates.
 */
export function fitHole(
  mask: Uint8Array,
  gw: number,
  gh: number,
  x: number,
  y: number,
  rPx: number,
  gapPx: number
): [number, number] {
  const xi = Math.max(0, Math.min(gw - 1, Math.round(x - 0.5)));
  const y0 = Math.max(0, Math.min(gh - 1, Math.round(y - 0.5)));
  const need = rPx + gapPx;
  const d = chamferToZero(mask, gw, gh);
  for (let yy = y0; yy < gh; yy++) {
    const i = yy * gw + xi;
    if (mask[i] && d[i] >= need) return [xi + 0.5, yy + 0.5];
  }
  return [x, y];
}

/** Punch a circular hole (e.g. a keyring hole) out of a mask. */
export function clearCircle(
  mask: Uint8Array,
  gw: number,
  gh: number,
  cx: number,
  cy: number,
  rPx: number
): void {
  const r2 = rPx * rPx;
  const x0 = Math.max(0, Math.floor(cx - rPx));
  const x1 = Math.min(gw - 1, Math.ceil(cx + rPx));
  const y0 = Math.max(0, Math.floor(cy - rPx));
  const y1 = Math.min(gh - 1, Math.ceil(cy + rPx));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) mask[y * gw + x] = 0;
    }
  }
}
