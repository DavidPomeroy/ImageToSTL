// Mesh generation: heightfield / extruded-region meshes built per pixel cell.
//
// Instead of emitting one box per region (which leaves coincident internal
// faces and therefore non-manifold edges), this emits only boundary faces:
// top/bottom per pixel and side faces only where solid meets empty or where
// the z-range changes. Side faces are split at every z level present in the
// part (all z values are layer-snapped), so every mesh edge is shared by
// exactly two triangles — the mesh is manifold, except at rare diagonal
// "pinch" corners (two cells touching only diagonally), which slicers
// handle gracefully.

/** Flat triangle soup: 9 numbers per triangle. */
export type TriangleSoup = number[];

function pushTri(
  out: TriangleSoup,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): void {
  out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
}

/**
 * Build a manifold heightfield mesh from per-pixel z ranges.
 * Pixel i is solid over [z0s[i], z1s[i]]; z1 <= z0 means empty (no geometry).
 * Image row 0 maps to maximum Y so the plate is not mirrored.
 */
export function buildHeightfieldGeometry(
  z0s: Float32Array | number[],
  z1s: Float32Array | number[],
  gw: number,
  gh: number,
  pixelSize: number
): TriangleSoup {
  const out: TriangleSoup = [];
  const s = pixelSize;
  const n = gw * gh;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= gw || y >= gh ? -1 : y * gw + x;
  const solid = (i: number): boolean => i >= 0 && z1s[i] > z0s[i] + 1e-9;

  // Global sorted z cuts: every z0/z1 in the part. Splitting all side faces
  // at these levels keeps vertical mesh edges consistently segmented
  // (no T-junctions between perpendicular faces).
  const cutSet = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (z1s[i] > z0s[i] + 1e-9) {
      cutSet.add(z0s[i]);
      cutSet.add(z1s[i]);
    }
  }
  const cuts = [...cutSet].sort((a, b) => a - b);

  // top + bottom faces
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = at(x, y);
      if (!solid(i)) continue;
      const x0 = x * s,
        x1 = x0 + s;
      const y1 = (gh - y) * s,
        y0 = y1 - s;
      const z0 = z0s[i],
        z1 = z1s[i];
      // top (+Z)
      pushTri(out, x0, y0, z1, x1, y0, z1, x1, y1, z1);
      pushTri(out, x0, y0, z1, x1, y1, z1, x0, y1, z1);
      // bottom (-Z)
      pushTri(out, x0, y0, z0, x0, y1, z0, x1, y1, z0);
      pushTri(out, x0, y0, z0, x1, y1, z0, x1, y0, z0);
    }
  }

  // For a boundary between cell intervals [a0,a1] and [b0,b1] (empty cell =
  // no interval), call emitA/emitB for each global-cut strip that is solid
  // in exactly one of the two cells.
  const emitStrips = (
    aSolid: boolean,
    a0: number,
    a1: number,
    bSolid: boolean,
    b0: number,
    b1: number,
    emitA: (lo: number, hi: number) => void,
    emitB: (lo: number, hi: number) => void
  ) => {
    for (let c = 0; c + 1 < cuts.length; c++) {
      const lo = cuts[c],
        hi = cuts[c + 1];
      const mid = (lo + hi) / 2;
      const inA = aSolid && a0 < mid && mid < a1;
      const inB = bSolid && b0 < mid && mid < b1;
      if (inA === inB) continue;
      if (inA) emitA(lo, hi);
      else emitB(lo, hi);
    }
  };

  // side faces on east-west boundaries (vertical plane x = xe*s)
  for (let y = 0; y < gh; y++) {
    const y1 = (gh - y) * s,
      y0 = y1 - s;
    for (let xe = 0; xe <= gw; xe++) {
      const a = at(xe - 1, y); // west cell
      const b = at(xe, y); // east cell
      const fa = solid(a),
        fb = solid(b);
      if (!fa && !fb) continue;
      const x = xe * s;
      emitStrips(
        fa,
        fa ? z0s[a] : 0,
        fa ? z1s[a] : 0,
        fb,
        fb ? z0s[b] : 0,
        fb ? z1s[b] : 0,
        // strip solid only in A -> east face of the west cell (+X normal)
        (lo, hi) => {
          pushTri(out, x, y0, lo, x, y1, lo, x, y1, hi);
          pushTri(out, x, y0, lo, x, y1, hi, x, y0, hi);
        },
        // strip solid only in B -> west face of the east cell (-X normal)
        (lo, hi) => {
          pushTri(out, x, y0, lo, x, y1, hi, x, y1, lo);
          pushTri(out, x, y0, lo, x, y0, hi, x, y1, hi);
        }
      );
    }
  }

  // side faces on north-south boundaries (horizontal plane y = (gh-b)*s)
  for (let b = 0; b <= gh; b++) {
    const yp = (gh - b) * s;
    for (let x = 0; x < gw; x++) {
      const a = at(x, b - 1); // north cell (higher world Y)
      const c = at(x, b); // south cell
      const fa = solid(a),
        fc = solid(c);
      if (!fa && !fc) continue;
      const x0 = x * s,
        x1 = x0 + s;
      emitStrips(
        fa,
        fa ? z0s[a] : 0,
        fa ? z1s[a] : 0,
        fc,
        fc ? z0s[c] : 0,
        fc ? z1s[c] : 0,
        // strip solid only in A -> south face of the north cell (-Y normal)
        (lo, hi) => {
          pushTri(out, x0, yp, lo, x1, yp, lo, x1, yp, hi);
          pushTri(out, x0, yp, lo, x1, yp, hi, x0, yp, hi);
        },
        // strip solid only in C -> north face of the south cell (+Y normal)
        (lo, hi) => {
          pushTri(out, x0, yp, lo, x1, yp, hi, x1, yp, lo);
          pushTri(out, x0, yp, lo, x0, yp, hi, x1, yp, hi);
        }
      );
    }
  }

  return out;
}

/**
 * Convenience: flat region extrusion. Cells where mask[i] != 0 are solid
 * over [z0, z1]; everything else is empty.
 */
export function buildRegionGeometry(
  mask: Uint8Array,
  gw: number,
  gh: number,
  pixelSize: number,
  z0: number,
  z1: number
): TriangleSoup {
  const z0s = new Float32Array(gw * gh);
  const z1s = new Float32Array(gw * gh);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) {
      z0s[i] = z0;
      z1s[i] = z1;
    }
  }
  return buildHeightfieldGeometry(z0s, z1s, gw, gh, pixelSize);
}
