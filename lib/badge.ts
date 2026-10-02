// Badge / keychain geometry: a shaped plate with raised text and an optional
// keyring hole. Text is rasterized from a font onto the shaped mask and both
// parts are extruded as manifold heightfields (fine pixels keep the stepped
// edges below the nozzle size). Two colours: plate + raised text.

import { buildMaskExtrusion, type TriangleSoup } from "./mesh";
import { modelBounds } from "./bounds";
import {
  badgeShapeMask,
  clearCircle,
  erodeMask,
  fitHole,
  runCentre,
  type BadgeShape,
} from "./masks";
import type { RGB } from "./quantize";

export interface BadgeInput {
  text: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  shape: BadgeShape;
  widthMm: number;
  heightMm: number;
  cornerMm: number;
  /** Plate thickness (mm). */
  plateMm: number;
  /** Height the text rises above the plate (mm). */
  textMm: number;
  /** Multiplier on the auto-fitted font size (0.3–1). */
  textScale: number;
  /** Inset from the edge for text / content (mm). */
  marginMm: number;
  holeEnabled: boolean;
  holeMm: number;
  /** Gap between the shape's edge (top, or the left end of a wide dog tag) and
   * the keyring hole (mm). */
  holeInsetMm: number;
  pixelMm: number;
}

export interface BadgePart {
  name: string;
  color: RGB;
  z0: number;
  z1: number;
  positions: TriangleSoup;
}

export interface BadgeResult {
  parts: BadgePart[];
  gw: number;
  gh: number;
  pixelSizeMm: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  triangleCount: number;
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  plateMask: Uint8Array;
  textMask: Uint8Array;
  warnings: string[];
}

function rasterizeText(
  text: string,
  gw: number,
  gh: number,
  clipMask: Uint8Array,
  input: BadgeInput,
  leftInsetPx = 0
): Uint8Array {
  const mask = new Uint8Array(gw * gh);
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) return mask;

  const canvas = document.createElement("canvas");
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const weight = input.bold ? "700 " : "";
  const style = input.italic ? "italic " : "";
  const marginPx = Math.max(1, input.marginMm / input.pixelMm);
  // A left-hand keyring hole pushes the text box to the right of it.
  const boxLeft = Math.max(0, Math.min(gw / 2, leftInsetPx));
  const textX = (boxLeft + gw) / 2;
  const availW = Math.max(4, gw - 2 * marginPx - boxLeft);
  const availH = Math.max(4, gh - 2 * marginPx);
  const lineH = 1.18;

  const setFont = (px: number) => {
    ctx.font = `${style}${weight}${px}px ${input.fontFamily}`;
  };
  let fontPx = availH / lines.length / lineH;
  for (let iter = 0; iter < 24 && fontPx > 4; iter++) {
    setFont(fontPx);
    let maxW = 0;
    for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    if (maxW <= availW) break;
    fontPx *= Math.min(0.98, availW / Math.max(1, maxW));
  }
  fontPx *= Math.max(0.3, Math.min(1, input.textScale));
  setFont(fontPx);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  const totalH = lines.length * fontPx * lineH;
  let y = gh / 2 - totalH / 2 + (fontPx * lineH) / 2;
  for (const l of lines) {
    ctx.fillText(l, textX, y);
    y += fontPx * lineH;
  }

  const data = ctx.getImageData(0, 0, gw, gh).data;
  for (let i = 0; i < mask.length; i++) {
    mask[i] = data[i * 4 + 3] >= 128 && clipMask[i] ? 1 : 0;
  }
  return mask;
}

/** Rasterize the plate silhouette, the raised text and the keyring hole. */
export function rasterizeBadge(input: BadgeInput): {
  plateMask: Uint8Array;
  textMask: Uint8Array;
  gw: number;
  gh: number;
  pixelMm: number;
} {
  const pixelMm = input.pixelMm;
  const gw = Math.max(16, Math.round(input.widthMm / pixelMm));
  const gh = Math.max(16, Math.round(input.heightMm / pixelMm));
  const plateMask = badgeShapeMask(input.shape, gw, gh, input.cornerMm / pixelMm);
  const marginPx = Math.max(1, input.marginMm / pixelMm);

  // Punch the keyring hole before the text is laid out, so the text keeps clear
  // of it. The hole is also nudged to where it actually fits: a heart's top
  // centre is the notch and a star's is a point, so a hole placed there would
  // fall outside the material (or clip the edge).
  let textInsetPx = 0;
  if (input.holeEnabled) {
    const rPx = input.holeMm / 2 / pixelMm;
    const insetPx = input.holeInsetMm / pixelMm;
    let hx: number;
    let hy: number;
    if (input.shape === "dogtag" && gw >= gh) {
      // A wide tag hangs from its (left) end, so the hole sits at mid-height.
      hx = insetPx + rPx;
      hy = gh / 2;
      textInsetPx = insetPx + 2 * rPx + marginPx;
    } else {
      hy = insetPx + rPx;
      hx =
        input.shape === "heart"
          ? runCentre(plateMask, gw, gh, Math.round(hy), 0, Math.floor(gw / 2))
          : gw / 2;
    }
    const [fx, fy] = fitHole(
      plateMask,
      gw,
      gh,
      hx,
      hy,
      rPx,
      Math.max(1, 0.5 / pixelMm)
    );
    clearCircle(plateMask, gw, gh, fx, fy, rPx);
  }

  const innerMask = erodeMask(plateMask, gw, gh, marginPx);
  const textMask = rasterizeText(input.text, gw, gh, innerMask, input, textInsetPx);
  return { plateMask, textMask, gw, gh, pixelMm };
}

/** Assemble the two parts from pre-rasterized masks (pure / testable). */
export function buildBadgeFromMasks(
  plateMask: Uint8Array,
  textMask: Uint8Array,
  gw: number,
  gh: number,
  pixelMm: number,
  opts: {
    plateMm: number;
    textMm: number;
    plateColor: RGB;
    textColor: RGB;
  }
): BadgeResult {
  const parts: BadgePart[] = [];
  const warnings: string[] = [];

  const plate = buildMaskExtrusion(
    plateMask,
    gw,
    gh,
    pixelMm,
    0,
    opts.plateMm
  );
  if (plate.length)
    parts.push({
      name: "Badge",
      color: opts.plateColor,
      z0: 0,
      z1: opts.plateMm,
      positions: plate,
    });

  const text = buildMaskExtrusion(
    textMask,
    gw,
    gh,
    pixelMm,
    opts.plateMm,
    opts.plateMm + opts.textMm
  );
  if (text.length)
    parts.push({
      name: "Text",
      color: opts.textColor,
      z0: opts.plateMm,
      z1: opts.plateMm + opts.textMm,
      positions: text,
    });

  const { bboxMm, centerMm } = modelBounds(parts);
  const depthMm = opts.plateMm + (text.length ? opts.textMm : 0);
  const triangleCount = parts.reduce((s, p) => s + p.positions.length, 0) / 9;
  if (parts.length === 0)
    warnings.push("Nothing to build — check the text and shape.");

  return {
    parts,
    gw,
    gh,
    pixelSizeMm: pixelMm,
    widthMm: gw * pixelMm,
    heightMm: gh * pixelMm,
    depthMm,
    triangleCount,
    bboxMm,
    centerMm,
    plateMask,
    textMask,
    warnings,
  };
}

/** One-shot: rasterize + build. */
export function buildBadge(
  input: BadgeInput,
  plateColor: RGB,
  textColor: RGB
): BadgeResult {
  const { plateMask, textMask, gw, gh, pixelMm } = rasterizeBadge(input);
  return buildBadgeFromMasks(plateMask, textMask, gw, gh, pixelMm, {
    plateMm: input.plateMm,
    textMm: input.textMm,
    plateColor,
    textColor,
  });
}

