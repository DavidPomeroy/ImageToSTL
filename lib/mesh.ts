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

/**
 * Interpolated vertex-sheet values for smoothing. For vertex (vx, vy) on the
 * sub-cell grid, bilinearly blend the surrounding pixel values, using only
 * filled pixels (edge-clamped); empty pixels contribute nothing. Returns a
 * (gw*2+1) x (gh*2+1) Float32Array in row-major order.
 */
function sampleSheets(
  z0s: Float32Array | number[],
  z1s: Float32Array | number[],
  gw: number,
  gh: number,
  sub: number
): { v0: Float32Array; v1: Float32Array } {
  const vw = gw * sub + 1;
  const vh = gh * sub + 1;
  const v0 = new Float32Array(vw * vh);
  const v1 = new Float32Array(vw * vh);
  const solid = (i: number) => i >= 0 && z1s[i] > z0s[i] + 1e-9;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? -1 : y * gw + x);

  for (let vy = 0; vy < vh; vy++) {
    // pixel-space center coordinate of this vertex
    const cy = vy / sub - 0.5;
    const y0 = Math.max(0, Math.min(gh - 1, Math.floor(cy)));
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, cy - y0));
    for (let vx = 0; vx < vw; vx++) {
      const cx = vx / sub - 0.5;
      const x0 = Math.max(0, Math.min(gw - 1, Math.floor(cx)));
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = Math.max(0, Math.min(1, cx - x0));

      // gather the (up to 4) surrounding pixels, filled only
      const ids = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
      let wSum = 0;
      let lo = 0;
      let hi = 0;
      const ws = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const i = ids[k];
        if (!solid(i)) continue;
        const wx = k % 2 === 0 ? 1 - tx : tx;
        const wy = k < 2 ? 1 - ty : ty;
        const w = wx * wy;
        if (w <= 0) continue;
        ws[k] = w;
        wSum += w;
        lo += z0s[i] * w;
        hi += z1s[i] * w;
      }
      const vi = vy * vw + vx;
      if (wSum > 1e-12) {
        v0[vi] = lo / wSum;
        v1[vi] = hi / wSum;
      }
    }
  }
  return { v0, v1 };
}

/**
 * Smooth heightfield mesh: top and bottom surfaces are bilinearly
 * interpolated between pixel centers on a 2x2 sub-cell grid, so relief
 * steps become gentle slopes (commercial-lithophane style). Side walls are
 * emitted only at the region boundary and follow the interpolated surface
 * heights — the mesh is manifold by construction.
 */
export function buildSmoothHeightfieldGeometry(
  z0s: Float32Array | number[],
  z1s: Float32Array | number[],
  gw: number,
  gh: number,
  pixelSize: number
): TriangleSoup {
  const out: TriangleSoup = [];
  const sub = 2;
  const s = pixelSize / sub; // sub-cell size
  const vw = gw * sub + 1;
  const vh = gh * sub + 1;
  const { v0, v1 } = sampleSheets(z0s, z1s, gw, gh, sub);
  const solid = (i: number) => i >= 0 && z1s[i] > z0s[i] + 1e-9;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? -1 : y * gw + x);

  const cellX = (x: number) => x * s;
  const cellY = (y: number) => (gh * sub - y) * s; // flip: image row 0 -> max Y

  const pushQuad = (
    ax: number, ay: number, av: number,
    bx: number, by: number, bv: number,
    cx: number, cy: number, cv: number,
    dx: number, dy: number, dv: number,
    sheet: (vi: number) => number,
    flip: boolean
  ) => {
    // vertices are grid indices; z comes from the sheet
    const za = sheet(av), zb = sheet(bv), zc = sheet(cv), zd = sheet(dv);
    const A: [number, number, number] = [ax, ay, za];
    const B: [number, number, number] = [bx, by, zb];
    const C: [number, number, number] = [cx, cy, zc];
    const D: [number, number, number] = [dx, dy, zd];
    if (flip) {
      pushTri(out, ...A, ...C, ...B);
      pushTri(out, ...A, ...D, ...C);
    } else {
      pushTri(out, ...A, ...B, ...C);
      pushTri(out, ...A, ...C, ...D);
    }
  };

  // top + bottom sheets over filled cells
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!solid(at(x, y))) continue;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          // vertex grid indices of this sub-cell (lower-left = (vx0, vy0))
          const vx0 = x * sub + sx;
          const vy0 = y * sub + sy;
          const w0 = cellX(vx0), w1 = cellX(vx0 + 1);
          const yTop = cellY(vy0), yBot = cellY(vy0 + 1);
          // world Y decreases as vy increases: vy0 row = top edge, vy0+1 = bottom
          const iTL = vy0 * vw + vx0;
          const iTR = iTL + 1;
          const iBL = iTL + vw;
          const iBR = iBL + 1;
          // top (+Z, CCW seen from above)
          pushQuad(w0, yBot, iBL, w1, yBot, iBR, w1, yTop, iTR, w0, yTop, iTL, (vi) => v1[vi], false);
          // bottom (-Z)
          pushQuad(w0, yBot, iBL, w0, yTop, iTL, w1, yTop, iTR, w1, yBot, iBR, (vi) => v0[vi], false);
        }
      }
    }
  }

  // side walls at the region boundary (empty neighbours), following the
  // interpolated surface heights on the shared sub-cell edges
  const wallEdge = (
    // emit a wall quad between two adjacent boundary vertices, spanning
    // [bottom, top] sheet values
    ax: number, ay: number, ai: number,
    bx: number, by: number, bi: number,
    outward: boolean
  ) => {
    const za0 = v0[ai], za1 = v1[ai];
    const zb0 = v0[bi], zb1 = v1[bi];
    if (outward) {
      pushTri(out, ax, ay, za0, bx, by, zb0, bx, by, zb1);
      pushTri(out, ax, ay, za0, bx, by, zb1, ax, ay, za1);
    } else {
      pushTri(out, ax, ay, za0, bx, by, zb1, bx, by, zb0);
      pushTri(out, ax, ay, za0, ax, ay, za1, bx, by, zb1);
    }
  };

  // vertical (east-west) boundary edges: for each filled pixel, the west and
  // east cell edges whose neighbour is empty
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = at(x, y);
      if (!solid(i)) continue;
      const vxW = x * sub;
      const vxE = (x + 1) * sub;
      for (let sy = 0; sy < sub; sy++) {
        const vy0 = y * sub + sy;
        const vy1 = vy0 + 1;
        const yTop = cellY(vy0), yBot = cellY(vy1);
        // west wall (-X outward) when the west neighbour is empty
        if (!solid(at(x - 1, y))) {
          wallEdge(cellX(vxW), yBot, vy1 * vw + vxW, cellX(vxW), yTop, vy0 * vw + vxW, false);
        }
        // east wall (+X outward)
        if (!solid(at(x + 1, y))) {
          wallEdge(cellX(vxE), yBot, vy1 * vw + vxE, cellX(vxE), yTop, vy0 * vw + vxE, true);
        }
      }
    }
  }

  // horizontal (north-south) boundary edges
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = at(x, y);
      if (!solid(i)) continue;
      const vyN = y * sub;
      const vyS = (y + 1) * sub;
      for (let sx = 0; sx < sub; sx++) {
        const vx0 = x * sub + sx;
        const vx1 = vx0 + 1;
        const x0 = cellX(vx0), x1 = cellX(vx1);
        // north wall (+Y outward; higher world Y = image row y)
        if (!solid(at(x, y - 1))) {
          wallEdge(x0, cellY(vyN), vyN * vw + vx0, x1, cellY(vyN), vyN * vw + vx1, false);
        }
        // south wall (-Y outward)
        if (!solid(at(x, y + 1))) {
          wallEdge(x0, cellY(vyS), vyS * vw + vx0, x1, cellY(vyS), vyS * vw + vx1, true);
        }
      }
    }
  }

  return out;
}
