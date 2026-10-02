// Bounding box + centre of a set of triangle-soup parts, shared by the tools
// so the 3D preview can be fitted without each page re-deriving it.

export interface ModelBounds {
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
}

export function modelBounds(parts: { positions: number[] }[]): ModelBounds {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;

  for (const p of parts) {
    const pos = p.positions;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const x = pos[i],
        y = pos[i + 1],
        z = pos[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  if (!isFinite(minX)) minX = maxX = minY = maxY = minZ = maxZ = 0;

  return {
    bboxMm: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    centerMm: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}
