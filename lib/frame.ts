// Picture-frame geometry for the Image → 3D plate.
//
// A frame is a "tray" that receives a plate from the Image → 3D tool: the plate
// drops in from the front onto a rebate ledge, leaving a cavity behind it for an
// LED strip / board (the air gap). The frame follows the plate's outline, so it
// supports the full rectangle plus the standard shapes (square, triangle,
// hexagon, circle, heart, star, diamond, cross).
//
// Every region of the frame is a per-cell height above the bed (z0 = 0), so the
// whole body is ONE manifold heightfield (lib/mesh.ts) with no coincident
// internal faces:
//
//        frame top (front)
//           ┌──────────────────────────┐
//           │  wall      (full height) │
//           │   ┌──────────┐           │
//   plate → │   │  PLATE   │  ledge    │  ← plate dropped in from the front
//   gap   → │   │  cavity  │           │  ← LED strip / board sits here
//   back  → │▓▓▓│  panel   │▓▓▓▓▓▓▓▓▓▓▓│  ← optional back panel (+ wire hole / LED channel)
//   z = 0   └───┴──────────┴───────────┘
//
// The frame outline is derived from the plate silhouette with a signed distance
// field (chamfer distance transform), so the border width is uniform all round
// and every offset (window, ledge, lip) follows the true silhouette instead of
// a scaled outline. Distances are quantised to the grid, which keeps the stepped
// shaped edges below the nozzle at the default resolution — the same approach
// the badge / coaster tools use.

import {
  buildHeightfieldGeometry,
  quantizeZ,
  type TriangleSoup,
} from "./mesh";
import { modelBounds } from "./bounds";
import { chamferToZero } from "./textSign";
import { bendPositions, shiftZ } from "./curve";
import { makeShapeSilhouette, type ShapeType } from "./shapes";
import { FRAME_SHAPE_TYPES } from "./framePrefill";
import type { RGB } from "./quantize";

const FRAME_SHAPE_LABELS: Record<string, string> = {
  rectangle: "Full (rectangle)",
  square: "Square",
  triangle: "Triangle",
  hexagon: "Hexagon",
  circle: "Circle",
  heart: "Heart",
  star: "Star",
  diamond: "Diamond",
  cross: "Cross",
};

/**
 * Shapes a frame can be built for: the full rectangle or a standard shape.
 * Derived from FRAME_SHAPE_TYPES (the Image → 3D "copy" bridge) so the two can
 * never drift apart.
 */
export const FRAME_SHAPES: { type: ShapeType; label: string }[] =
  FRAME_SHAPE_TYPES.map((type) => ({
    type,
    label: FRAME_SHAPE_LABELS[type] ?? type,
  }));

/** How the plate is held: a friction/tape rebate, or a retaining front lip. */
export type FrameRetain = "rebate" | "lip";
/** The frame's back: open (rear LED access), solid panel, or panel with a groove. */
export type FrameBack = "open" | "panel" | "channel";

export interface FrameInput {
  // ---- the plate to receive (from the Image → 3D tool) ----
  /** Plate width (matches the image tool's "Print width"). */
  plateWidthMm: number;
  /** Plate height (image tool: width × image aspect). */
  plateHeightMm: number;
  /** Plate thickness (image tool: "Depth"), i.e. the height of its columns. */
  plateThicknessMm: number;
  /** Full-image rectangle or a standard shape. */
  shapeType: ShapeType;
  /** Shape centre across the plate, 0..1 (standard shapes only). */
  shapeCx: number;
  /** Shape centre down the plate, 0..1 (standard shapes only). */
  shapeCy: number;
  /** Shape span as a fraction of the plate's smaller side (standard shapes). */
  shapeSize: number;

  // ---- frame body ----
  /** Gap around the plate so it drops in (mm). */
  clearanceMm: number;
  /** Visible front border width (mm). */
  borderMm: number;
  /** Rebate ledge width that supports the plate edge (mm). */
  ledgeMm: number;
  /** Air gap behind the plate for the LED (mm). */
  gapMm: number;
  /** How far the plate front sits below the frame front (mm). */
  revealMm: number;
  /**
   * Plate curvature (degrees). 0 = flat; > 0 bends the frame around the same
   * vertical axis as the Image → 3D "Curvature" setting (a partial or full
   * cylinder / lamp shade) so the rebate follows the curved plate.
   */
  curveDeg: number;
  /** Rebate only, or add a retaining front lip. */
  retain: FrameRetain;
  /** Front lip overlap on the plate edge (mm). */
  lipMm: number;
  /**
   * Slide-in lip: height of the open band across the plate's TOP edge (mm), so
   * the plate drops in from the top behind the side/bottom lip. 0 = closed ring.
   */
  lipOpenMm: number;
  /**
   * Slide-in lip: keep a thin centred tab over the top opening as a snap stop
   * (the plate flexes past it). Off = open top (gravity retention).
   */
  topStop: boolean;

  // ---- back / LED mounting ----
  back: FrameBack;
  /** Back panel thickness (mm); ignored when `back` is "open". */
  backMm: number;
  /** LED channel width in the panel (mm); used when `back` is "channel". */
  channelWidthMm: number;
  /** LED channel depth in the panel (mm); used when `back` is "channel". */
  channelDepthMm: number;
  /** Wire hole diameter through the back panel (mm); 0 = none. */
  wireHoleMm: number;

  /** Grid resolution: cells across the larger footprint side. */
  resolution: number;
  color: RGB;
}

export interface FramePart {
  name: string;
  color: RGB;
  z0: number;
  z1: number;
  positions: TriangleSoup;
}

export interface FrameResult {
  parts: FramePart[];
  gw: number;
  gh: number;
  pixelSizeMm: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  triangleCount: number;
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  /** RGBA overlay of the frame footprint for the 2D preview. */
  preview: Uint8ClampedArray;
  /** Frame solid height (mm) at a model-space point (x right, y up). */
  heightAt(xMm: number, yMm: number): number;
  warnings: string[];
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));


/**
 * Build the frame that receives a plate of the given outline and size (pure).
 * All geometry is a single manifold heightfield plus an optional (separate)
 * retaining-lip shell.
 */
export function buildFrame(input: FrameInput): FrameResult {
  const warnings: string[] = [];

  const plateW = Math.max(5, input.plateWidthMm);
  const plateH = Math.max(5, input.plateHeightMm);
  const plateThk = Math.max(0.2, input.plateThicknessMm);
  const border = Math.max(0.5, input.borderMm);
  const res = clamp(Math.round(input.resolution), 60, 600);
  const curveDeg = clamp(input.curveDeg, 0, 360);

  // Curvature: the plate is a cylinder arc whose inner (back) radius is
  // R = width / theta (see lib/curve.ts). The frame bends around the same axis
  // with the same radius, so its rebate lines up with the curved plate. The
  // arc-direction (width) border is capped so the frame never wraps past a full
  // turn and overlaps itself — a full cylinder has no room for a side border.
  const theta = (Math.min(curveDeg, 359.5) * Math.PI) / 180;
  const bent = curveDeg > 0.01;
  const bendR = bent ? plateW / theta : Infinity;
  const arcCapMm = bent ? ((2 * Math.PI - theta) / 2) * bendR : Infinity;
  const borderX = Math.min(border, arcCapMm); // arc / width direction
  const borderY = border; // height direction (top / bottom rims)

  // Grid: the plate footprint (at this resolution) padded by the border all
  // round, so the frame extends `border` beyond the plate.
  const footprintW = plateW + 2 * borderX;
  const footprintH = plateH + 2 * borderY;
  const pixelSize = Math.max(footprintW, footprintH) / res;
  const padX = Math.max(0, Math.round(borderX / pixelSize));
  const padY = Math.max(1, Math.round(borderY / pixelSize));
  const gw = Math.max(1, Math.round(plateW / pixelSize));
  const gh = Math.max(1, Math.round(plateH / pixelSize));
  const FW = gw + 2 * padX;
  const FH = gh + 2 * padY;
  const n = FW * FH;

  // ---- plate footprint mask: the shape, clipped to the plate rectangle ----
  const rectangular = input.shapeType === "rectangle";
  const silhouette = rectangular
    ? null
    : makeShapeSilhouette(
        {
          type: input.shapeType,
          cx: input.shapeCx,
          cy: input.shapeCy,
          size: input.shapeSize,
        },
        gw,
        gh
      );
  const plateMask = new Uint8Array(n);
  for (let fy = 0; fy < FH; fy++) {
    for (let fx = 0; fx < FW; fx++) {
      const px = fx + 0.5 - padX; // plate-space x, 0..gw
      const py = fy + 0.5 - padY; // plate-space y, 0..gh
      if (px < 0 || px > gw || py < 0 || py > gh) continue;
      if (!silhouette || silhouette.inside(px, py)) plateMask[fy * FW + fx] = 1;
    }
  }

  // ---- signed distance (in cells) to the plate silhouette (+ inside) ----
  const dIn = chamferToZero(plateMask, FW, FH); // inside -> nearest outside
  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = plateMask[i] ? 0 : 1;
  const dOut = chamferToZero(inv, FW, FH); // outside -> nearest inside
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = plateMask[i] ? dIn[i] : -dOut[i];

  // ---- band thresholds (cells) ----
  const cw = Math.max(0.1, input.clearanceMm) / pixelSize;
  const ledge = Math.max(0.5, input.ledgeMm) / pixelSize;
  const lip = Math.max(0, input.lipMm) / pixelSize;
  const outerReach = cw + Math.max(padX, padY);

  // ---- heights (mm) ----
  const backThk = input.back === "open" ? 0 : Math.max(0.2, input.backMm);
  const gap = Math.max(0, input.gapMm);
  const reveal = Math.max(0, input.revealMm);
  const plateBottom = backThk + gap;
  const plateTop = plateBottom + plateThk;
  const top = plateTop + reveal;

  // ---- per-cell height (z0 = 0): wall / ledge / cavity floor ----
  const z1 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = dist[i];
    if (!rectangular && s < -outerReach) {
      z1[i] = 0; // outside the frame
    } else if (s < -cw) {
      z1[i] = top; // perimeter wall (full height)
    } else if (s <= ledge) {
      z1[i] = plateBottom; // rebate ledge / seat
    } else {
      z1[i] = backThk; // cavity floor (panel) or open
    }
  }

  // Wire hole through the back panel, centred under the plate.
  if (backThk > 0 && input.wireHoleMm > 0) {
    const cx = padX + gw / 2;
    const cy = padY + gh / 2;
    const rPx = input.wireHoleMm / 2 / pixelSize;
    const r2 = rPx * rPx;
    for (let fy = 0; fy < FH; fy++) {
      for (let fx = 0; fx < FW; fx++) {
        const dx = fx + 0.5 - cx;
        const dy = fy + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = fy * FW + fx;
        // Only bore the panel; never touch the wall or the ledge.
        if (Math.abs(z1[i] - backThk) < 1e-9) z1[i] = 0;
      }
    }
  }

  // LED channel: a groove in the panel just inside the ledge.
  if (input.back === "channel" && backThk > 0) {
    const chW = Math.max(1, input.channelWidthMm) / pixelSize;
    const chD = Math.min(backThk, Math.max(0, input.channelDepthMm));
    for (let i = 0; i < n; i++) {
      const s = dist[i];
      if (Math.abs(z1[i] - backThk) < 1e-9 && s >= ledge && s <= ledge + chW) {
        z1[i] = Math.max(0, backThk - chD);
      }
    }
  }

  quantizeZ(z1);
  const positions = buildHeightfieldGeometry(
    new Float32Array(n),
    z1,
    FW,
    FH,
    pixelSize
  );

  // Optional retaining lip — a slide-in rim so the plate can actually be
  // inserted. The lip lives in the [plateTop, top] slab and the plate in
  // [plateBottom, plateTop], so removing the lip across the plate's TOP edge
  // lets the plate drop in from the top, behind the side/bottom lip, onto the
  // rebate ledge. It is its own manifold part (a coincident shell merged into
  // the body would leave 4-way edges along the shared faces). The optional top
  // stop is a thin centred tab (a snap fit) over that opening.
  const lipOn = input.retain === "lip" && input.lipMm > 0;
  const openCells = Math.max(0, input.lipOpenMm) / pixelSize;
  const stopThk = Math.min(0.8, reveal);
  const stopHalf =
    input.topStop && stopThk > 0
      ? Math.max(
          1,
          Math.round(
            Math.min(30, Math.max(8, plateW * 0.25)) / pixelSize / 2
          )
        )
      : 0;
  const cxCells = padX + gw / 2;
  let lipSoup: TriangleSoup | null = null;
  if (lipOn) {
    const lz0 = new Float32Array(n);
    const lz1 = new Float32Array(n);
    let any = false;
    for (let fy = 0; fy < FH; fy++) {
      const py = fy + 0.5 - padY;
      for (let fx = 0; fx < FW; fx++) {
        const i = fy * FW + fx;
        const s = dist[i];
        if (s < -cw || s > lip) continue; // not part of the lip ring
        if (py < openCells) {
          // top opening band: only the optional snap tab survives
          if (stopHalf <= 0) continue;
          if (Math.abs(fx + 0.5 - cxCells) > stopHalf) continue;
          lz0[i] = plateTop;
          lz1[i] = plateTop + stopThk;
        } else {
          lz0[i] = plateTop;
          lz1[i] = top;
        }
        any = true;
      }
    }
    if (any) lipSoup = buildHeightfieldGeometry(lz0, lz1, FW, FH, pixelSize);
  }

  // ---- 2D preview: frame material, cavity and the plate window ----
  const preview = new Uint8ClampedArray(n * 4);
  const col = input.color;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const z = z1[i];
    const s = dist[i];
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    if (z > 1e-9) {
      // frame material; the back panel / channel reads darker than the top.
      let k = 1;
      if (z < plateBottom - 1e-9) k = 0.5;
      else if (z < top - 1e-9) k = 0.78;
      r = col[0] * k;
      g = col[1] * k;
      b = col[2] * k;
      a = 255;
    } else if (s >= -cw) {
      // the plate window (where the image will show through).
      r = 92;
      g = 92;
      b = 99;
      a = 255;
    }
    preview[o] = r;
    preview[o + 1] = g;
    preview[o + 2] = b;
    preview[o + 3] = a;
  }

  const parts: FramePart[] = [
    { name: "Frame body", color: input.color, z0: 0, z1: top, positions },
  ];
  if (lipSoup && lipSoup.length > 0) {
    parts.push({
      name: "Frame lip",
      color: input.color,
      z0: plateTop,
      z1: top,
      positions: lipSoup,
    });
  }

  // ---- curvature: bend the frame around the plate's own axis ----
  // The plate maps (x, y, z) -> radius (R + z), angle (x - w/2)/R (lib/curve.ts).
  // Shifting the frame so the plate sits on the axis and its back is at z = 0
  // and then reusing bendPositions puts the rebate exactly where the plate will
  // land, so the curved plate drops into the curved frame.
  if (bent) {
    const xShift = padX * pixelSize;
    let minZ = Infinity;
    for (const p of parts) {
      const pos = p.positions;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] -= xShift; // centre the plate on the bend axis
        pos[i + 2] -= plateBottom; // plate back -> radial base
      }
      const m = bendPositions(pos, plateW, curveDeg);
      if (m < minZ) minZ = m;
    }
    if (isFinite(minZ) && Math.abs(minZ) > 1e-9)
      for (const p of parts) shiftZ(p.positions, -minZ);
  }

  const { bboxMm, centerMm } = modelBounds(parts);

  const heightAt = (xMm: number, yMm: number): number => {
    const fx = Math.floor(xMm / pixelSize);
    const fy = FH - 1 - Math.floor(yMm / pixelSize);
    if (fx < 0 || fy < 0 || fx >= FW || fy >= FH) return 0;
    return z1[fy * FW + fx];
  };

  // ---- warnings ----
  if (pixelSize < 0.4) {
    warnings.push(
      `Cell size ${pixelSize.toFixed(2)} mm is below a typical 0.4 mm nozzle — ` +
        `lower the resolution or widen the frame.`
    );
  } else if (pixelSize > 0.6) {
    warnings.push(
      `Cell size ${pixelSize.toFixed(2)} mm is coarse — the shaped outline may ` +
        `show visible steps; raise the resolution.`
    );
  }
  if (gap < 5) {
    warnings.push(
      `The air gap is only ${gap.toFixed(1)} mm — most LED strips and boards ` +
        `need 8–15 mm behind the plate.`
    );
  }
  if (input.clearanceMm < 0.2) {
    warnings.push(
      `Fit clearance ${input.clearanceMm.toFixed(2)} mm is tight — the plate ` +
        `may not drop in; 0.2–0.4 mm suits most printers.`
    );
  }
  if (bent && borderX < border - 0.01) {
    warnings.push(
      `The ${curveDeg}° arc leaves no room for a ${border.toFixed(1)} mm side ` +
        `border — it was reduced to ${borderX.toFixed(1)} mm so the frame does ` +
        `not wrap past a full turn.`
    );
  }
  if (bent && bendR <= plateBottom) {
    warnings.push(
      `The bend radius (${bendR.toFixed(1)} mm) is smaller than the back ` +
        `thickness + air gap (${plateBottom.toFixed(1)} mm) — reduce the gap or ` +
        `the curvature.`
    );
  }
  if (lipOn) {
    warnings.push(
      input.lipOpenMm > 0
        ? "Slide-in lip: drop the plate in from the top edge and keep that edge " +
            "up. The lip overhangs — bridge/support it or print the frame " +
            "front-down so it is the first layer."
        : "The lip is a closed ring — the plate cannot be inserted. Set a Top " +
            "opening so it slides in."
    );
    if (input.topStop && stopThk <= 0) {
      warnings.push(
        "Top stop needs a plate reveal greater than 0 (no room above the plate " +
          "front for the tab)."
      );
    }
  }

  return {
    parts,
    gw: FW,
    gh: FH,
    pixelSizeMm: pixelSize,
    widthMm: FW * pixelSize,
    heightMm: FH * pixelSize,
    depthMm: top,
    triangleCount: parts.reduce((s, p) => s + p.positions.length, 0) / 9,
    bboxMm,
    centerMm,
    preview,
    heightAt,
    warnings,
  };
}

