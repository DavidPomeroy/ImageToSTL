// Plate curvature: bend the flat plate around a vertical (image-height) axis
// so it forms a partial or full cylinder — the classic curved lithophane /
// lamp-shade shape.
//
// The plate's width becomes the arc length of the INNER surface
// (radius R = width / theta). The bend wraps the width around the axis and
// keeps the image height running ALONG the axis, which becomes the print's
// up axis — so the bent plate stands on its bottom edge (the image's bottom
// row), exactly like a lamp shade, and the image surface faces outward:
//   a flat point at (x, y, z) maps to radius R + z, angle phi = (x-w/2)/R:
//     X' = (R + z) * sin(phi)
//     Y' = R - (R + z) * cos(phi)   (radial offset, horizontal)
//     Z' = y                        (image height = print height)
// With Z' = y the bottom face (y = 0) is a flat annular sector lying in the
// z = 0 plane, so the solid rests on the bed over its full bottom area
// (a thin ring / arc) instead of touching along the two end edges.
// The map is a proper rotation of the wrapped surface (det = +1), so a
// manifold mesh with outward normals stays manifold and outward-facing.
//
// The transform is a smooth homeomorphism (for theta < 360deg), so manifold
// meshes stay manifold. Full 360deg is clamped to 359.5deg internally so the
// seam edges never coincide (that would be non-manifold) — the ~0.5deg gap
// is a printable seam, and handy for lamp fittings.

export function curveRadius(widthMm: number, curveDeg: number): number {
  if (curveDeg < 0.01) return Infinity;
  const theta = (Math.min(curveDeg, 359.5) * Math.PI) / 180;
  return widthMm / theta;
}

/**
 * Bend all vertex positions of a flat-plate mesh in place — WITHOUT any
 * bed translation. Returns the bent mesh's minimum Z (0 if not bent).
 * Multi-part plates must bend every part first and translate all of them by
 * the same GLOBAL min Z afterwards; translating per part would pull stacked
 * bands out of radial alignment.
 */
export function bendPositions(
  positions: number[],
  widthMm: number,
  curveDeg: number
): number {
  if (curveDeg < 0.01 || positions.length < 9) return 0;
  const theta = (Math.min(curveDeg, 359.5) * Math.PI) / 180;
  const R = widthMm / theta;
  const half = widthMm / 2;

  let minZ = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const phi = (x - half) / R;
    const rad = R + z;
    positions[i] = rad * Math.sin(phi);
    positions[i + 1] = R - rad * Math.cos(phi);
    positions[i + 2] = y;
    if (y < minZ) minZ = y;
  }
  return isFinite(minZ) ? minZ : 0;
}

/** Shift all vertices of a mesh by dz (used for the shared bed placement). */
export function shiftZ(positions: number[], dz: number): void {
  if (dz === 0) return;
  for (let i = 2; i < positions.length; i += 3) positions[i] += dz;
}

/**
 * Convenience for single-mesh plates: bend and rest the solid on the bed.
 * Do NOT use for stacked multi-part plates — see bendPositions.
 */
export function applyCurve(
  positions: number[],
  widthMm: number,
  curveDeg: number
): void {
  const minZ = bendPositions(positions, widthMm, curveDeg);
  if (isFinite(minZ)) shiftZ(positions, -minZ);
}
