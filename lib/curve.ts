// Plate curvature: bend the flat plate around a vertical (image-height) axis
// so it forms a partial or full cylinder — the classic curved lithophane /
// lamp-shade shape.
//
// The plate's width becomes the arc length of the INNER surface
// (radius R = width / theta). The image surface faces outward: a flat point
// at (x, y, z) maps to radius R + z, angle phi = (x - width/2) / R:
//   X' = (R + z) * sin(phi)
//   Y' = y
//   Z' = (R + z) * cos(phi) - R   (then shifted so the solid rests on the
//                                bed, min Z = 0)
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

/** Bend all vertex positions of a flat-plate mesh in place. */
export function applyCurve(
  positions: number[],
  widthMm: number,
  curveDeg: number
): void {
  if (curveDeg < 0.01 || positions.length < 9) return;
  const theta = (Math.min(curveDeg, 359.5) * Math.PI) / 180;
  const R = widthMm / theta;
  const half = widthMm / 2;

  let minZ = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    const phi = (x - half) / R;
    const rad = R + z;
    positions[i] = rad * Math.sin(phi);
    positions[i + 2] = rad * Math.cos(phi) - R;
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
  }
  if (!isFinite(minZ)) return;
  // rest the solid on the bed (min Z = 0)
  if (minZ < 0) {
    for (let i = 2; i < positions.length; i += 3) positions[i] -= minZ;
  }
}
