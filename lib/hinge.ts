// Print-in-place pin / knuckle hinge for the Box → 3D tool.
//
// The hinge axis runs along X (a straight edge of the box). A round pin (part
// of the box) passes through C-shaped knuckles (part of the lid) that wrap it
// with radial clearance — so the lid pivots once the print is broken free.
//
// Geometry is emitted as closed triangle soups. Each soup is a manifold solid
// on its own; the slicer unions it with whatever leaf it overlaps (the pin
// overlaps the box wall, the knuckles overlap the lid), and the 0.3 mm pin
// clearance keeps the two leaves free of each other.
//
// Rules of thumb used here (from print-in-place design guides):
//   - radial pin clearance ≈ 0.3 mm (0.2–0.35 for FDM PLA);
//   - knuckle wall ≥ 1.5–2 mm around the pin;
//   - the pin sits low enough to be supported by the box wall during printing.

import earcut from "earcut";
import type { TriangleSoup } from "./mesh";

/**
 * Extrude a simple 2D polygon (points [y, z] in the YZ plane, CCW) along X over
 * [x0, x1]. Produces a closed manifold prism (two caps + side walls).
 */
export function extrudeProfileX(
  profile: number[][],
  x0: number,
  x1: number
): TriangleSoup {
  const flat: number[] = [];
  for (const p of profile) flat.push(p[0], p[1]);
  const idx = earcut(flat);
  const out: TriangleSoup = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = profile[idx[i]];
    const b = profile[idx[i + 1]];
    const c = profile[idx[i + 2]];
    // front cap (x0), winding reversed; back cap (x1)
    out.push(x0, a[0], a[1], x0, c[0], c[1], x0, b[0], b[1]);
    out.push(x1, a[0], a[1], x1, b[0], b[1], x1, c[0], c[1]);
  }
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % profile.length];
    out.push(x1, b[0], b[1], x1, a[0], a[1], x0, a[0], a[1]);
    out.push(x0, b[0], b[1], x1, b[0], b[1], x0, a[0], a[1]);
  }
  return out;
}

/** A round pin (cylinder) with its axis along X, centred at (cy, cz). */
export function buildPinX(
  cy: number,
  cz: number,
  r: number,
  x0: number,
  x1: number,
  segs = 32
): TriangleSoup {
  const profile: number[][] = [];
  for (let i = 0; i < segs; i++) {
    const t = (2 * Math.PI * i) / segs;
    profile.push([cy + r * Math.cos(t), cz + r * Math.sin(t)]);
  }
  return extrudeProfileX(profile, x0, x1);
}

/**
 * A thin vertical web (a rectangular slab) along X, from z0 to z1 — mounts the
 * hinge pin on the box wall so a flat-printed lid's knuckles can slide onto the
 * pin. It bites into the wall (z0 just below the rim) so a slicer unions the two.
 */
export function buildWebX(
  cy: number,
  z0: number,
  z1: number,
  thk: number,
  x0: number,
  x1: number
): TriangleSoup {
  const h = thk / 2;
  const profile: number[][] = [
    [cy - h, z0],
    [cy + h, z0],
    [cy + h, z1],
    [cy - h, z1],
  ];
  return extrudeProfileX(profile, x0, x1);
}

/**
 * A "C" knuckle (annular sector) wrapping the pin. It opens at `gapCentre`
 * (± gapHalf, radians); the opening faces the box wall so the wrap never dips
 * into it. Inner radius = pin + clearance, outer = pin + wall.
 */
export function buildKnuckleX(
  cy: number,
  cz: number,
  ri: number,
  ro: number,
  x0: number,
  x1: number,
  gapCentre: number,
  gapHalf: number,
  segs = 28
): TriangleSoup {
  // Arc from just past the gap, all the way round to just before it.
  const t0 = gapCentre + gapHalf;
  const t1 = gapCentre + 2 * Math.PI - gapHalf;
  const profile: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = t0 + ((t1 - t0) * i) / segs;
    profile.push([cy + ro * Math.cos(t), cz + ro * Math.sin(t)]);
  }
  for (let i = segs; i >= 0; i--) {
    const t = t0 + ((t1 - t0) * i) / segs;
    profile.push([cy + ri * Math.cos(t), cz + ri * Math.sin(t)]);
  }
  return extrudeProfileX(profile, x0, x1);
}
