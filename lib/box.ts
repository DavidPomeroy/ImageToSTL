// Box geometry for the Image → 3D plate.
//
// A box is a hollow container (floor + perimeter walls) whose opening receives
// the Image → 3D plate as its lid. The lid is a second part: a plug on its
// underside registers into the opening (with clearance), and a picture-frame-
// style recess on top holds the plate. The plate footprint is larger than the
// opening, so the lid lands on the box rim and cannot drop through.
//
// Everything is a per-cell height above the bed (z0 = 0) built as ONE manifold
// heightfield (lib/mesh.ts) per part, so there are no coincident internal faces:
//
//   box (side view)                 lid (side view, printed beside the box)
//   ┌────────────────┐             ┌───────────────────┐  ← lid top
//   │ wall           │             │  recess (plate)   │  ← plate drops in
//   │    ┌───────┐   │             ├───────────────────┤
//   │    │ cavity│   │  ← opening  │   plug            │  ← fits the opening
//   │    │       │   │             │    ┌─────────┐    │
//   │▓▓▓▓│ floor │▓▓▓│  ← z = wall └────┴─────────┴────┘
//   └────┴───────┴───┘
//
// The box outline is derived from the plate silhouette with a signed distance
// field (chamfer distance transform), so every offset (opening, wall, recess,
// plug) follows the true silhouette instead of a scaled outline — the same
// approach the frame / badge / coaster tools use.

import {
  buildHeightfieldGeometry,
  quantizeZ,
  type TriangleSoup,
} from "./mesh";
import { modelBounds } from "./bounds";
import { chamferToZero } from "./textSign";
import { makeShapeSilhouette, type ShapeType } from "./shapes";
import { BOX_SHAPE_TYPES } from "./boxPrefill";
import { buildPinX, buildKnuckleX, buildWebX } from "./hinge";
import type { RGB } from "./quantize";

const BOX_SHAPE_LABELS: Record<string, string> = {
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
 * Shapes a box can be built for: the full rectangle or a standard shape.
 * Derived from BOX_SHAPE_TYPES (the Image → 3D "copy" bridge) so the two can
 * never drift apart.
 */
export const BOX_SHAPES: { type: ShapeType; label: string }[] =
  BOX_SHAPE_TYPES.map((type) => ({
    type,
    label: BOX_SHAPE_LABELS[type] ?? type,
  }));

/** How the lid is supplied: none (open box), a separate printed lid, a
 *  print-in-place hinged lid, or a hinged lid printed separately and slid onto
 *  the box's pin (no support needed). */
export type BoxLid = "none" | "separate" | "hinged" | "hinged-separate";

export interface BoxInput {
  // ---- the plate that becomes the lid (from the Image → 3D tool) ----
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

  // ---- box body ----
  /** Wall and floor thickness (mm). */
  wallMm: number;
  /** Interior cavity depth (mm), from the floor top to the opening. */
  depthMm: number;
  /** How far the plate overhangs the opening (mm), each side. */
  overhangMm: number;
  /** Lid fit clearance (mm). */
  clearanceMm: number;
  /** How deep the lid's plug enters the opening (mm). */
  plugDepthMm: number;
  /** Lid plug draft/bevel angle from vertical (degrees, 0–45). The plug is full
   *  width at the lid and tapers this much narrower at the bed end so its walls
   *  stay self-supporting (no support) when the lid is printed plug-down. */
  plugBevelDeg?: number;
  /** Hinged lid only: radial pin clearance (mm). */
  hingeClearanceMm?: number;
  /** Build a matching separate lid, printed beside the box. */
  lid: BoxLid;

  /** Grid resolution: cells across the larger footprint side. */
  resolution: number;
  color: RGB;
}

export interface BoxPart {
  name: string;
  color: RGB;
  z0: number;
  z1: number;
  positions: TriangleSoup;
}

export interface BoxResult {
  parts: BoxPart[];
  gw: number;
  gh: number;
  pixelSizeMm: number;
  /** Box outer width (mm). */
  widthMm: number;
  /** Box outer height (mm). */
  heightMm: number;
  /** Box total height (mm) — floor + cavity. */
  depthMm: number;
  triangleCount: number;
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  /** RGBA overlay of the box footprint for the 2D preview. */
  preview: Uint8ClampedArray;
  /** Box solid height (mm) at a model-space point (x right, y up). */
  heightAt(xMm: number, yMm: number): number;
  warnings: string[];
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * Build the box (and optional separate lid) that receives a plate of the given
 * outline and size (pure). All geometry is a single manifold heightfield per
 * part. The plate is the lid: it overhangs the opening, so the lid rests on the
 * box rim.
 */
export function buildBox(input: BoxInput): BoxResult {
  const warnings: string[] = [];

  const plateW = Math.max(5, input.plateWidthMm);
  const plateH = Math.max(5, input.plateHeightMm);
  const plateThk = Math.max(0.2, input.plateThicknessMm);
  const wall = Math.max(0.5, input.wallMm);
  const depth = Math.max(1, input.depthMm);
  const res = clamp(Math.round(input.resolution), 60, 600);

  // The plate must overhang the opening, and the lid rim (= wall − overhang)
  // must be positive and wider than the fit clearance.
  const overhang = clamp(input.overhangMm, 0.2, Math.max(0.2, wall - 0.5));
  const rim = wall - overhang; // lid rim / box outer margin past the plate
  const clearance = clamp(input.clearanceMm, 0.05, Math.max(0.05, rim - 0.1));
  const plugDepth = clamp(input.plugDepthMm, 0.5, Math.max(0.5, depth - 0.5));

  // Grid: the box outer footprint (plate + rim all round) padded by the rim.
  const footprintW = plateW + 2 * rim;
  const footprintH = plateH + 2 * rim;
  const pixelSize = Math.max(footprintW, footprintH) / res;
  const padX = Math.max(1, Math.round(rim / pixelSize));
  const padY = Math.max(1, Math.round(rim / pixelSize));
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

  // ---- thresholds (cells) ----
  const overCells = overhang / pixelSize; // plate -> opening edge
  const clrCells = clearance / pixelSize;
  const plugThresh = overCells + clrCells; // inside the plug
  const recessThresh = -clrCells; // inside the plate recess
  const outerReach = Math.max(padX, padY); // outside the box

  // Plug bevel: a draft so the plug's walls stay self-supporting when the lid is
  // printed plug-down. The plug is full width at the lid and tapers `bevelCells`
  // narrower at the bed end; the angle is clamped to 45° (the support limit) and
  // so it can never eat the whole plug.
  const bevelDeg = clamp(input.plugBevelDeg ?? 45, 0, 45);
  let maxDist = 0;
  for (let i = 0; i < n; i++) if (dist[i] > maxDist) maxDist = dist[i];
  const bevelCells = Math.min(
    (plugDepth * Math.tan((bevelDeg * Math.PI) / 180)) / pixelSize,
    maxDist * 0.5
  );
  // Snap the bevel to a whole number of steps: the chamfer distance mixes 1 and
  // √2, so a continuous ramp makes z-values that differ by <1e-3 and produce
  // degenerate (zero-height) faces. Discrete levels keep the z cuts clean.
  const bevelSteps = Math.max(1, Math.round(bevelCells));

  // ---- heights (mm) ----
  const floor = wall;
  const boxTop = wall + depth;
  // The lid base is a slab: a pocket (`plateThk` deep) is cut from its top to
  // hold the plate, so it must stay solid (`wall` thick) under that pocket.
  const lidBase = plateThk + wall;
  const lidTop = plugDepth + lidBase;

  // ---- box body: cavity floor + full-height perimeter wall ----
  const boxZ1 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = dist[i];
    if (!rectangular && s < -outerReach) {
      boxZ1[i] = 0; // outside the box
    } else if (s < overCells) {
      boxZ1[i] = boxTop; // perimeter wall (full height)
    } else {
      boxZ1[i] = floor; // cavity floor
    }
  }
  quantizeZ(boxZ1);
  const boxPositions = buildHeightfieldGeometry(
    new Float32Array(n),
    boxZ1,
    FW,
    FH,
    pixelSize
  );

  // ---- hinge layout (print-in-place): sit on the shape's flat TOP edge ----
  const boxW = FW * pixelSize;
  // A pin hinge must lie on a straight, horizontal edge of the outline. Find the
  // topmost solid row of the plate footprint and its widest run — that is the
  // shape's flat top edge. A pointed top (triangle, star, circle) gives a
  // too-narrow run, so the hinge is skipped and a separate lid is built (with a
  // warning). This also keeps the pin inside the box for every shape.
  //
  // TODO (later, not now): support a hinge on a flat SIDE/BOTTOM edge for the
  // pointed-top outlines (triangle, star, circle, heart) — the pin would run
  // at an angle along that straight edge and the lid would open from there
  // (needs an outward/rotation-sign pass and a rotated knuckle gap direction).
  let topFy = -1;
  let rx0 = 0;
  let rx1 = -1;
  for (let fy = 0; fy < FH && topFy < 0; fy++) {
    let run = 0;
    let cs = -1;
    let best = 0;
    let bs = 0;
    let be = -1;
    for (let fx = 0; fx < FW; fx++) {
      if (plateMask[fy * FW + fx]) {
        if (cs < 0) cs = fx;
        run++;
        if (run > best) {
          best = run;
          bs = cs;
          be = fx;
        }
      } else {
        run = 0;
        cs = -1;
      }
    }
    if (best > 0) {
      topFy = fy;
      rx0 = bs;
      rx1 = be;
    }
  }
  const hingeWidthMm = rx1 >= rx0 ? (rx1 - rx0 + 1) * pixelSize : 0;
  const hingedInPlace = input.lid === "hinged";
  const hingedSeparate = input.lid === "hinged-separate";
  const hingeRequested = hingedInPlace || hingedSeparate;
  const hingeOk =
    hingeRequested && hingeWidthMm >= Math.max(10, boxW * 0.14);
  const hingeY = topFy >= 0 ? (FH - topFy) * pixelSize + rim : boxTop;
  const hingeZ = boxTop; // the wall top
  const hingeX0 = rx0 * pixelSize;
  const hingeX1 = (rx1 + 1) * pixelSize;
  const pinR = clamp(wall * 0.7, 1.2, 2.2);
  const pinClr = clamp(input.hingeClearanceMm ?? 0.3, 0.1, 0.5);
  const ri = pinR + pinClr; // knuckle bore (pin + clearance)
  const ro = pinR + Math.max(1.5, pinR); // knuckle outer (pin + wall)

  // Print-in-place: the pin sits on the rim and overlaps the wall (the slicer
  // unions the two; the lid prints standing open). Separate (axial-slide): the
  // pin stands just outside the lid's edge (near side clears the flat lid, far
  // side sits under the knuckle) on an L-shaped mount — a vertical fin plus a
  // foot onto the wall — so the flat-printed lid's knuckles slide on from one
  // end; the knuckle opening faces down (over the fin).
  const pinY = hingedSeparate ? hingeY + pinR + 0.4 : hingeY;
  const pinZ = hingedSeparate ? boxTop + ro + pinClr : hingeZ;
  const webThk = Math.max(0.8, pinR * 0.5);
  const webDrop = Math.max(1, wall * 0.5); // bites into the wall so it unions
  const sepGapCentre = (270 * Math.PI) / 180; // opening faces down / the fin
  const sepGapHalf = (80 * Math.PI) / 180;

  // ---- box part (+ the hinge pin, which overlaps the wall so it is unioned) ----
  if (hingeOk) {
    boxPositions.push(...buildPinX(pinY, pinZ, pinR, hingeX0, hingeX1));
    if (hingedSeparate) {
      // Vertical fin under the pin, plus a horizontal foot tying the fin base
      // back onto the box wall (the pin sits just outside the lid's edge).
      const footInner = pinY - ro; // reaches in over the wall, under the lid edge
      const footOuter = pinY + webThk / 2;
      boxPositions.push(
        ...buildWebX(pinY, boxTop - webDrop, pinZ, webThk, hingeX0, hingeX1)
      );
      boxPositions.push(
        ...buildWebX(
          (footInner + footOuter) / 2,
          boxTop - webDrop,
          boxTop,
          footOuter - footInner,
          hingeX0,
          hingeX1
        )
      );
    }
  }
  const parts: BoxPart[] = [
    {
      name: "Box",
      color: input.color,
      z0: 0,
      z1: boxTop,
      positions: boxPositions,
    },
  ];

  // ---- lid: plug + plate recess (separate: beside; hinged: opened 90°) ----
  if (input.lid !== "none") {
    const lz0 = new Float32Array(n);
    const lz1 = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const s = dist[i];
      if (!rectangular && s < -outerReach) continue; // outside the lid
      // The plug reaches the bed at full width; its outer band is beveled so the
      // wall tapers in toward the bed (self-supporting when printed plug-down).
      if (bevelCells > 1e-6) {
        if (s >= plugThresh + bevelCells) lz0[i] = 0;
        else if (s >= plugThresh) {
          const t = clamp((s - plugThresh) / bevelCells, 0, 1);
          lz0[i] = plugDepth * (1 - Math.round(t * bevelSteps) / bevelSteps);
        } else lz0[i] = plugDepth;
      } else {
        lz0[i] = s >= plugThresh ? 0 : plugDepth; // plug reaches the bed
      }
      lz1[i] = s >= recessThresh ? lidTop - plateThk : lidTop; // plate recess
      any = true;
    }
    if (any) {
      quantizeZ(lz0);
      quantizeZ(lz1);
      const lidPositions = buildHeightfieldGeometry(
        lz0,
        lz1,
        FW,
        FH,
        pixelSize
      );
      let z1 = lidTop;
      if (hingeOk && hingedInPlace) {
        // Print open: drop the plug into the opening, open the lid 90° about
        // the flat-edge hinge (it stands up in line with the wall), then lift
        // it clear of the pin. The knuckles (fixed at the hinge) wrap the pin.
        const lift = pinR + pinClr;
        for (let i = 0; i < lidPositions.length; i += 3) {
          const x = lidPositions[i];
          const y = lidPositions[i + 1];
          const zClosed = lidPositions[i + 2] + (hingeZ - plugDepth);
          const dy = y - hingeY;
          const dz = zClosed - hingeZ;
          lidPositions[i] = x;
          lidPositions[i + 1] = hingeY + dz; // open 90° about X at the hinge
          lidPositions[i + 2] = hingeZ - dy + lift;
        }
        const gapCentre = (250 * Math.PI) / 180; // opening faces the wall
        const gapHalf = (80 * Math.PI) / 180;
        const spanW = hingeX1 - hingeX0;
        const kCount =
          spanW >= 3 * (2 * ro) ? 3 : spanW >= 2 * (2 * ro) ? 2 : 1;
        const kw = Math.min(2 * ro, (spanW / kCount) * 0.85);
        for (let k = 0; k < kCount; k++) {
          const cx = hingeX0 + (spanW * (k + 0.5)) / kCount;
          const x0 = clamp(cx - kw / 2, hingeX0, hingeX1);
          const x1 = clamp(cx + kw / 2, hingeX0, hingeX1);
          if (x1 - x0 < 1) continue;
          lidPositions.push(
            ...buildKnuckleX(hingeY, hingeZ, ri, ro, x0, x1, gapCentre, gapHalf)
          );
        }
        z1 = hingeZ + hingeY; // the opened lid stands about this tall
      } else {
        // Printed beside the box (a 10 mm gap) so the two do not overlap.
        const dx = boxW + 10;
        for (let i = 0; i < lidPositions.length; i += 3)
          lidPositions[i] += dx;
        if (hingeOk && hingedSeparate) {
          // Separate (axial-slide) hinge: attach the knuckles at the hinge in
          // the lid's own flat frame. The lid lifts by `boxTop - plugDepth` onto
          // the box, so the pin at `pinZ` lands at `plugDepth + (pinZ - boxTop)`.
          // The opening faces down (over the pin's web); slide the knuckles on
          // from one end of the pin to assemble.
          const kz = plugDepth + (pinZ - boxTop);
          const spanW = hingeX1 - hingeX0;
          const kCount =
            spanW >= 3 * (2 * ro) ? 3 : spanW >= 2 * (2 * ro) ? 2 : 1;
          const kw = Math.min(2 * ro, (spanW / kCount) * 0.85);
          for (let k = 0; k < kCount; k++) {
            const cx = hingeX0 + (spanW * (k + 0.5)) / kCount;
            const x0 = clamp(cx - kw / 2, hingeX0, hingeX1);
            const x1 = clamp(cx + kw / 2, hingeX0, hingeX1);
            if (x1 - x0 < 1) continue;
            lidPositions.push(
              ...buildKnuckleX(
                pinY,
                kz,
                ri,
                ro,
                x0 + dx,
                x1 + dx,
                sepGapCentre,
                sepGapHalf
              )
            );
          }
          z1 = Math.max(z1, kz + ro); // the knuckles stand a touch proud
        }
      }
      parts.push({
        name: "Lid",
        color: input.color,
        z0: 0,
        z1,
        positions: lidPositions,
      });
    }
  }




  const { bboxMm, centerMm } = modelBounds(parts);

  const heightAt = (xMm: number, yMm: number): number => {
    const fx = Math.floor(xMm / pixelSize);
    const fy = FH - 1 - Math.floor(yMm / pixelSize);
    if (fx < 0 || fy < 0 || fx >= FW || fy >= FH) return 0;
    return boxZ1[fy * FW + fx];
  };

  // ---- 2D preview: box footprint (walls, cavity floor) ----
  const preview = new Uint8ClampedArray(n * 4);
  const col = input.color;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const z = boxZ1[i];
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    if (z > 1e-9) {
      const k = z > floor + 1e-9 ? 1 : 0.55; // wall brighter than the floor
      r = col[0] * k;
      g = col[1] * k;
      b = col[2] * k;
      a = 255;
    }
    preview[o] = r;
    preview[o + 1] = g;
    preview[o + 2] = b;
    preview[o + 3] = a;
  }

  // ---- warnings ----
  if (pixelSize < 0.4) {
    warnings.push(
      `Cell size ${pixelSize.toFixed(2)} mm is below a typical 0.4 mm nozzle — ` +
        `lower the resolution or widen the box.`
    );
  } else if (pixelSize > 0.6) {
    warnings.push(
      `Cell size ${pixelSize.toFixed(2)} mm is coarse — the shaped outline may ` +
        `show visible steps; raise the resolution.`
    );
  }
  if (rim < 1) {
    warnings.push(
      `The lid rim is only ${rim.toFixed(1)} mm wide — increase the wall ` +
        `thickness or reduce the lid overhang.`
    );
  }
  if (input.clearanceMm < 0.2) {
    warnings.push(
      `Fit clearance ${input.clearanceMm.toFixed(2)} mm is tight — the lid may ` +
        `not seat; 0.2–0.4 mm suits most printers.`
    );
  }
  if (depth < 8) {
    warnings.push(
      `A box depth of ${depth.toFixed(1)} mm is shallow — most contents need ` +
        `more room.`
    );
  }
  if (plugDepth > depth - 1) {
    warnings.push(
      `The plug (${plugDepth.toFixed(1)} mm) nearly reaches the floor — reduce ` +
        `the plug depth or deepen the box.`
    );
  }
  if (hingeRequested && !hingeOk) {
    warnings.push(
      `A hinge needs a straight, flat top edge — the ${input.shapeType} ` +
        `outline has a pointed top, so a separate lid was built instead.`
    );
  }

  return {
    parts,
    gw: FW,
    gh: FH,
    pixelSizeMm: pixelSize,
    widthMm: FW * pixelSize,
    heightMm: FH * pixelSize,
    depthMm: boxTop,
    triangleCount: parts.reduce((s, p) => s + p.positions.length, 0) / 9,
    bboxMm,
    centerMm,
    preview,
    heightAt,
    warnings,
  };
}

