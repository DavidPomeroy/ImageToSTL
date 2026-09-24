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

import type { ShapeSilhouette } from "./shapes";

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
 * Precomputed fine-resolution shape membership map, shared by every color
 * part of a plate so all parts clip to exactly the same silhouette.
 */
export interface FineShapeGrid {
  /** Fine cells per pixel edge. */
  sub: number;
  fw: number;
  fh: number;
  /** 1 when the fine cell's center is inside the shape (row-major, fw wide). */
  inside: Uint8Array;
  /**
   * 1 when an outside cell lies within ~3 fine cells of this cell — a cheap
   * precomputed band used to gate the exact point tests near the silhouette
   * without paying for them deep in the interior.
   */
  nearOutside: Uint8Array;
  /** Exact point-inside test for arbitrary fractional pixel coordinates. */
  testInside(px: number, py: number): boolean;
  /** Nearest shape-boundary point for fractional pixel coordinates. */
  project(px: number, py: number): [number, number];
}

/** Refine a shape silhouette into a fine cell-membership map. */
export function makeFineShapeGrid(
  silhouette: ShapeSilhouette,
  gw: number,
  gh: number,
  sub: number
): FineShapeGrid {
  const s = Math.max(1, Math.min(8, Math.round(sub)));
  const fw = gw * s;
  const fh = gh * s;
  let inside: Uint8Array;
  if (silhouette.fillFine) {
    inside = silhouette.fillFine(gw, gh, s); // scanline fast path
  } else {
    inside = new Uint8Array(fw * fh);
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        if (silhouette.inside((fx + 0.5) / s, (fy + 0.5) / s)) {
          inside[fy * fw + fx] = 1;
        }
      }
    }
  }
  // Dilate the outside mask by ~3 fine cells (three 3x3 passes), so a vertex
  // can check its four adjacent cells to know whether it is near the
  // silhouette at all. This gates the exact point test, which is expensive
  // for many-edge polygons (heart = 72 edges).
  const nearOutside = new Uint8Array(fw * fh);
  for (let i = 0; i < fw * fh; i++) nearOutside[i] = inside[i] ? 0 : 1;
  for (let pass = 0; pass < 3; pass++) {
    const prev = nearOutside.slice();
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const i = fy * fw + fx;
        if (prev[i]) continue;
        if (
          (fx > 0 && prev[i - 1]) ||
          (fx < fw - 1 && prev[i + 1]) ||
          (fy > 0 && prev[i - fw]) ||
          (fy < fh - 1 && prev[i + fw]) ||
          (fx > 0 && fy > 0 && prev[i - fw - 1]) ||
          (fx < fw - 1 && fy > 0 && prev[i - fw + 1]) ||
          (fx > 0 && fy < fh - 1 && prev[i + fw - 1]) ||
          (fx < fw - 1 && fy < fh - 1 && prev[i + fw + 1])
        ) {
          nearOutside[i] = 1;
        }
      }
    }
  }
  return {
    sub: s,
    fw,
    fh,
    inside,
    nearOutside,
    testInside: silhouette.inside,
    project: silhouette.project,
  };
}

/**
 * Snap per-cell z values to a 1e-6 mm (1 nanometre) grid, in place.
 *
 * Print-layer z values are computed with different expression orders per
 * cell (e.g. 0.2 * 3 vs 0.2 + 0.2 + 0.2), so numerically identical layers can
 * differ in the last bits. The flat builders split side walls at every z
 * level present in a part, and near-equal levels produce hairline strips
 * whose triangles coincide to within float noise — which shows up as
 * non-manifold edges / slicer repair prompts. Quantising to a nanometre
 * removes the noise without any printable effect.
 */
export function quantizeZ(z: Float32Array | number[]): void {
  for (let i = 0; i < z.length; i++) {
    z[i] = Math.round(z[i] * 1e6) / 1e6;
  }
}

/**
 * Fine-cell border-ring classification, shared by every colour part of a
 * plate: 1 when the cell's center lies inside the shape AND within `px`
 * pixels (Euclidean) of the silhouette. Used instead of a per-pixel
 * "border ring" so the ring reaches exactly out to the silhouette (no ragged
 * one-pixel band of interior treatment short of the edge) and its inner edge
 * follows the true inward offset of the shape instead of a pixel staircase.
 */
export function computeRingMask(
  fine: FineShapeGrid,
  gw: number,
  gh: number,
  px: number
): Uint8Array {
  const fw = fine.fw;
  const fh = fine.fh;
  const sub = fine.sub;
  const ring = new Uint8Array(fw * fh);
  if (px <= 0) return ring;
  let anyOutside = false;
  for (let i = 0; i < fw * fh; i++) {
    if (!fine.inside[i]) {
      anyOutside = true;
      break;
    }
  }
  if (!anyOutside) {
    // Full-image rectangle (or a shape that swallows the whole grid): the
    // border is a frame around the image edges.
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const cx = (fx + 0.5) / sub;
        const cy = (fy + 0.5) / sub;
        if (Math.min(cx, cy, gw - cx, gh - cy) <= px) ring[fy * fw + fx] = 1;
      }
    }
    return ring;
  }
  // Multi-source BFS (8-connected, Chebyshev hops) from the outside cells to
  // bound the exact distance tests. A cell whose center is within `px` pixels
  // of the boundary is at most ~1.5*px*sub + 3 hops away (a diagonal hop
  // covers sqrt(2) fine cells), so the band never misses a ring cell.
  const K = Math.ceil(px * sub * 1.5) + 3;
  const hops = new Int32Array(fw * fh).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < fw * fh; i++) {
    if (!fine.inside[i]) {
      hops[i] = 0;
      frontier.push(i);
    }
  }
  for (let h = 0; h < K && frontier.length; h++) {
    const next: number[] = [];
    for (const i of frontier) {
      const fx = i % fw;
      const fy = (i / fw) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = fx + [1, -1, 0, 0, 1, 1, -1, -1][k];
        const ny = fy + [0, 0, 1, -1, 1, -1, 1, -1][k];
        if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
        const j = ny * fw + nx;
        if (hops[j] !== -1) continue;
        hops[j] = h + 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  for (let fy = 0; fy < fh; fy++) {
    for (let fx = 0; fx < fw; fx++) {
      const i = fy * fw + fx;
      if (!fine.inside[i] || hops[i] < 0) continue;
      const cx = (fx + 0.5) / sub;
      const cy = (fy + 0.5) / sub;
      const [qx, qy] = fine.project(cx, cy);
      if (Math.hypot(cx - qx, cy - qy) <= px) ring[i] = 1;
    }
  }
  return ring;
}

/**
 * Border-ring assignment for one colour part of a plate.
 */
export interface RingSpec {
  /** Ring width in pixels (Euclidean distance to the silhouette). */
  px: number;
  /** Fine-cell ring mask from `computeRingMask` (shared by all parts). */
  mask: Uint8Array;
  /** Whether ring cells belong to this part (the border colour / relief). */
  owns: boolean;
  /**
   * Whether some OTHER part of the plate also owns ring cells (CMYK: all
   * four parts share the ring). Gates the diagonal-contact repair: a RING
   * cell may only be cleared when another part's ring covers it, otherwise
   * the clear would punch a hole in the border along the outline.
   */
  othersOwnRing: boolean;
  /** z range of ring cells in this part. */
  z0: number;
  z1: number;
}

/**
 * Shape-clipped heightfield mesh with analytic (smooth) silhouette edges.
 *
 * Every pixel cell is refined into `sub` x `sub` fine cells; a fine cell is
 * solid only if its parent pixel is solid AND its center lies inside the
 * shape. Vertices whose surrounding fine cells straddle the shape boundary
 * are then snapped onto the exact silhouette, so straight shape edges are
 * perfectly straight and curved edges follow the true curve (at the fine
 * grid's vertex density) instead of a one-pixel staircase.
 *
 * The same fine grid and the same deterministic snap rule are used for every
 * color part, so parts continue to tile side by side with no gaps or overlaps
 * and the mesh stays manifold by construction.
 *
 * `smooth` bilinearly interpolates the top/bottom z sheets between pixel
 * centers (relief smoothing); otherwise z is flat per pixel and side walls
 * are split at every z level present in the part, keeping vertically stacked
 * parts manifold.
 *
 * `ring` describes the border ring: fine cells within `ring.px` pixels of
 * the silhouette (per `ring.mask`, computed once for the whole plate) belong
 * to the border treatment instead of their parent pixel — they carry the
 * ring z range for the part that owns the ring, and no material at all for
 * the other parts. Vertices straddling the ring's inner contour snap onto
 * the true inward offset of the silhouette, so the border's inner edge is a
 * smooth line/curve, matching its outer (silhouette) edge.
 *
 * `othersSolid` (per pixel) marks pixels that carry material in some OTHER
 * part of the plate. It gates the diagonal-contact repair: a contact whose
 * orthogonal cells are empty for this part is cleared only when another part
 * covers the cleared cell too — clearing there keeps the part manifold
 * without opening a hole in the combined plate. Where no other part covers
 * it, the zero-volume point contact is left as-is (as the shipped per-pixel
 * builder produced); punching the cell out would leave a gap along the
 * outline.
 */
export function buildShapeClippedGeometry(
  z0s: Float32Array | number[],
  z1s: Float32Array | number[],
  gw: number,
  gh: number,
  pixelSize: number,
  fine: FineShapeGrid,
  smooth = false,
  ring?: RingSpec | null,
  othersSolid?: Uint8Array | null
): TriangleSoup {
  const out: TriangleSoup = [];
  const sub = fine.sub;
  const fs = pixelSize / sub;
  const fw = fine.fw;
  const fh = fine.fh;
  const vw = fw + 1;
  const vh = fh + 1;
  const EPS_AREA = 1e-10;
  const parentSolid = (i: number): boolean =>
    i >= 0 && z1s[i] > z0s[i] + 1e-9;

  // fine cell states: 0 = empty, 1 = solid, 2 = solid parent clipped by shape
  // Ring cells (inside the shape within `ring.px` of its boundary) override
  // their pixel: material of the ring's z range for the part that owns the
  // ring, nothing at all for the others — this is what makes the border
  // reach exactly out to the silhouette instead of stopping a ragged
  // half-pixel short of it.
  const state = new Uint8Array(fw * fh);
  const ringMask = ring && ring.px > 0 ? ring.mask : null;
  const ringOwns = ringMask ? !!ring!.owns : false;
  for (let fy = 0; fy < fh; fy++) {
    for (let fx = 0; fx < fw; fx++) {
      const i = fy * fw + fx;
      const x = (fx / sub) | 0;
      const y = (fy / sub) | 0;
      if (ringMask && fine.inside[i] && ringMask[i]) {
        state[i] = ringOwns ? 1 : 0;
        continue;
      }
      if (!parentSolid(y * gw + x)) continue;
      state[i] = fine.inside[i] ? 1 : 2;
    }
  }
  const cell = (fx: number, fy: number): number =>
    fx < 0 || fy < 0 || fx >= fw || fy >= fh ? 0 : state[fy * fw + fx];
  /** Pixel index behind a fine cell. */
  const parentIndexOfFine = (idx: number): number =>
    Math.floor(idx / fw / sub) * gw + Math.floor((idx % fw) / sub);

  // Diagonal contact repair. Two solid cells touching only at a corner make
  // the solid edge-non-manifold (four side walls share one vertical edge —
  // Bambu Studio refuses such meshes instead of silently repairing them).
  // Prefer to *fill* one of the two orthogonal cells — but only a cell whose
  // parent pixel already carries this part (silhouette-clipped), using its
  // own pixel's z range, so the fill connects the diagonal pair with material
  // that was always supposed to be there. If both orthogonals belong to
  // pixels with no material for this part but lie OUTSIDE the shape, the
  // fill borrows the diagonal partner's own z range for this part: the
  // partner carries the part, so nothing is invented across parts or bands,
  // and the filled sliver is clipped to the silhouette by the boundary
  // vertex snap. If both orthogonals lie inside the shape, the contact is
  // cleared only when another part of the plate covers the cleared cell too
  // (per `othersSolid`): the part stays manifold and the combined plate keeps
  // its material. Where no other part covers it, the zero-volume point
  // contact is left as-is — exactly what the shipped per-pixel builder
  // produced at such corners — because clearing there would punch a real
  // hole in the plate along the outline.
  const fillSrc = new Int32Array(fw * fh).fill(-1); // borrowed z donor pixel
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const borrowFill = (cell: number, partner: number) => {
      state[cell] = 1;
      fillSrc[cell] = parentIndexOfFine(partner);
      changed = true;
    };
    for (let fy = 0; fy < fh - 1; fy++) {
      for (let fx = 0; fx < fw - 1; fx++) {
        const i = fy * fw + fx;
        if (
          state[i] === 1 &&
          state[i + fw + 1] === 1 &&
          state[i + 1] !== 1 &&
          state[i + fw] !== 1
        ) {
          const fillA = state[i + 1] === 2;
          const fillB = state[i + fw] === 2;
          if (fillA) state[i + 1] = 1;
          else if (fillB) state[i + fw] = 1;
          else if (!fine.inside[i + 1]) borrowFill(i + 1, i);
          else if (!fine.inside[i + fw]) borrowFill(i + fw, i);
          else {
            const diag = i + fw + 1;
            const diagIsRing = !!ringMask && !!ringMask[diag];
            if (
              (diagIsRing ? ring!.othersOwnRing : !!othersSolid && !!othersSolid[parentIndexOfFine(diag)])
            ) {
              state[diag] = 0;
            }
          }
          if (fillA || fillB) changed = true;
        } else if (
          state[i + 1] === 1 &&
          state[i + fw] === 1 &&
          state[i] !== 1 &&
          state[i + fw + 1] !== 1
        ) {
          const fillA = state[i] === 2;
          const fillB = state[i + fw + 1] === 2;
          if (fillA) state[i] = 1;
          else if (fillB) state[i + fw + 1] = 1;
          else if (!fine.inside[i]) borrowFill(i, i + 1);
          else if (!fine.inside[i + fw]) borrowFill(i + fw, i + 1);
          else {
            const diag = i + fw;
            const diagIsRing = !!ringMask && !!ringMask[diag];
            if (
              (diagIsRing ? ring!.othersOwnRing : !!othersSolid && !!othersSolid[parentIndexOfFine(diag)])
            ) {
              state[diag] = 0;
            }
          }
          if (fillA || fillB) changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Per-vertex z sheets (smooth relief) or per-fine-cell flat z values.
  let sheets: { v0: Float32Array; v1: Float32Array } | null = null;
  if (smooth) {
    sheets = sampleSheets(z0s, z1s, gw, gh, sub);
    // In the border ring the relief is the border's flat z, not the image
    // data: override every vertex that touches a ring cell (ring cells
    // themselves, and the shared edge with the first interior cells, so the
    // ring's plateau edge lands exactly on the snapped inner contour).
    if (ringMask && ring!.owns) {
      const { v0, v1 } = sheets;
      for (let vy = 0; vy < vh; vy++) {
        for (let vx = 0; vx < vw; vx++) {
          let touchesRing = false;
          for (let oy = -1; oy <= 0 && !touchesRing; oy++) {
            for (let ox = -1; ox <= 0; ox++) {
              const fx = vx + ox;
              const fy = vy + oy;
              if (fx < 0 || fy < 0 || fx >= fw || fy >= fh) continue;
              const i = fy * fw + fx;
              if (ringMask[i] && fine.inside[i]) {
                touchesRing = true;
                break;
              }
            }
          }
          if (touchesRing) {
            const vi = vy * vw + vx;
            v0[vi] = ring!.z0;
            v1[vi] = ring!.z1;
          }
        }
      }
    }
  }
  const fz0 = new Float32Array(fw * fh);
  const fz1 = new Float32Array(fw * fh);
  let cuts: number[] = [];
  if (!smooth) {
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const i = fy * fw + fx;
        if (state[i] !== 1) continue;
        // every solid cell carries its own pixel's z range — repairs never
        // invent material, so no cell borrows another pixel's heights (a
        // silhouette-corner sliver borrows its diagonal partner's range, the
        // only source that already carries this part)
        const pi = fillSrc[i] >= 0 ? fillSrc[i] : parentIndexOfFine(i);
        fz0[i] = z0s[pi];
        fz1[i] = z1s[pi];
      }
    }
    // Ring cells carry the border's flat z range instead of their pixel's.
    if (ringMask && ring!.owns) {
      for (let i = 0; i < fw * fh; i++) {
        if (ringMask[i] && state[i] === 1) {
          fz0[i] = ring!.z0;
          fz1[i] = ring!.z1;
        }
      }
    }
    // nanometre snap (see quantizeZ) so float noise in layer maths cannot
    // create hairline wall strips; cuts then come from the snapped values
    quantizeZ(fz0);
    quantizeZ(fz1);
    const cutSet = new Set<number>();
    for (let i = 0; i < fz0.length; i++) {
      if (fz1[i] > fz0[i] + 1e-9) {
        cutSet.add(fz0[i]);
        cutSet.add(fz1[i]);
      }
    }
    cuts = [...cutSet].sort((a, b) => a - b);
  }

  // Vertex XY: fine grid positions, with boundary vertices snapped onto the
  // exact shape silhouette (guard against pathological projections: never
  // move further than ~1.5 fine cells). A vertex that carries material
  // snaps when
  //   - its neighbouring fine cells straddle the silhouette, or
  //   - it is outside the shape itself — including the corners of
  //     pinch-filled cells whose whole neighbourhood is outside, which would
  //     otherwise poke out past the outline.
  // The exact test is only run near the silhouette (a dilated band, plus the
  // image rim where tangent boundaries can run parallel to the grid), so
  // interior vertices cost nothing even for many-edge shapes.
  const posX = new Float64Array(vw * vh);
  const posY = new Float64Array(vw * vh);
  const gridX = new Float64Array(vw * vh);
  const gridY = new Float64Array(vw * vh);
  const snapped = new Uint8Array(vw * vh);
  const silCell = (fx: number, fy: number): number =>
    fx < 0 || fy < 0 || fx >= fw || fy >= fh ? -1 : fine.inside[fy * fw + fx];
  const nearOutsideCell = (fx: number, fy: number): number =>
    fx < 0 || fy < 0 || fx >= fw || fy >= fh
      ? 0
      : fine.nearOutside[fy * fw + fx];
  for (let vy = 0; vy < vh; vy++) {
    for (let vx = 0; vx < vw; vx++) {
      let x = vx * fs;
      let y = (fh - vy) * fs;
      let silInCount = 0;
      let silTotal = 0;
      let solidCount = 0;
      let nearOut = false;
      for (let oy = -1; oy <= 0; oy++) {
        for (let ox = -1; ox <= 0; ox++) {
          if (cell(vx + ox, vy + oy) === 1) solidCount++;
          const s = silCell(vx + ox, vy + oy);
          if (s < 0) continue; // outside the image: not part of the silhouette
          silTotal++;
          if (s === 1) silInCount++;
          if (nearOutsideCell(vx + ox, vy + oy)) nearOut = true;
        }
      }
      const px = vx / sub;
      const py = vy / sub;
      // On the image rim the silhouette can run almost parallel to the grid,
      // so the dilation band may not reach the outside cells; those vertices
      // are few, so always run the exact test there.
      const onRim = vx === 0 || vy === 0 || vx === fw || vy === vh - 1;
      let doSnap = false;
      if (solidCount > 0) {
        if (silInCount > 0 && silInCount < silTotal) {
          // straddling vertex: part of the neighbourhood lies outside the shape
          doSnap = true;
        } else if (
          (nearOut || onRim) &&
          // vertex outside the shape while carrying material: either every
          // neighbouring cell center is outside (pinch-filled corner cells)
          // or the vertex itself is just past the boundary.
          (silInCount === 0 || !fine.testInside(px, py))
        ) {
          doSnap = true;
        }
      }
      if (doSnap) {
        const [qx, qy] = fine.project(px, py);
        if (Math.hypot(qx - px, qy - py) <= 1.5) {
          x = qx * pixelSize;
          y = (gh - qy) * pixelSize;
        } else {
          doSnap = false;
        }
      } else if (ringMask) {
        // Border-ring inner contour: vertices whose inside neighbourhood
        // straddles the ring mask snap onto the true inward offset of the
        // silhouette (nearest boundary point moved inward along the local
        // normal), so the ring's inner edge is a smooth line/curve instead
        // of a fine-cell staircase. The rule uses only the part-independent
        // ring mask, so every part snaps shared vertices to the same point
        // and the parts keep tiling without gaps or overlaps.
        let ringInCount = 0;
        let ringTotal = 0;
        for (let oy = -1; oy <= 0; oy++) {
          for (let ox = -1; ox <= 0; ox++) {
            const fx = vx + ox;
            const fy = vy + oy;
            if (fx < 0 || fy < 0 || fx >= fw || fy >= fh) continue;
            const i = fy * fw + fx;
            if (!fine.inside[i]) continue;
            ringTotal++;
            if (ringMask[i]) ringInCount++;
          }
        }
        if (ringInCount > 0 && ringInCount < ringTotal) {
          const [qx, qy] = fine.project(px, py);
          const d = Math.hypot(px - qx, py - qy);
          if (d > 1e-9 && d <= ring!.px + 1) {
            const tx = qx + ((px - qx) / d) * ring!.px;
            const ty = qy + ((py - qy) / d) * ring!.px;
            // guard against pathological projections (e.g. deep concave
            // star valleys): never move further than ~2 fine cells
            if (Math.hypot(tx - px, ty - py) <= 2 / sub) {
              x = tx * pixelSize;
              y = (gh - ty) * pixelSize;
              doSnap = true;
            }
          }
        }
      }
      const vi = vy * vw + vx;
      gridX[vi] = vx * fs;
      gridY[vi] = (fh - vy) * fs;
      posX[vi] = x;
      posY[vi] = y;
      if (doSnap) snapped[vi] = 1;
    }
  }

  // Repair pass: if snapping ever collapses a solid cell's quad (two corners
  // landing on the same boundary point, e.g. at a star tip), revert the
  // snap for that cell's corners. Reverting only ever moves vertices back to
  // their distinct grid positions, so a pass or two resolves every collapse
  // while keeping every mesh edge shared by exactly two triangles.
  // Mirror emitQuad's degeneracy test exactly: a quad is emittable when one
  // of its two diagonals splits it into two non-degenerate triangles.
  const tri2Area = (
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number
  ): number => Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
  const quadEmittable = (
    iTL: number,
    iTR: number,
    iBR: number,
    iBL: number
  ): boolean => {
    const ax = posX[iTL], ay = posY[iTL];
    const bx = posX[iTR], by = posY[iTR];
    const cx = posX[iBR], cy = posY[iBR];
    const dx = posX[iBL], dy = posY[iBL];
    const okAC =
      tri2Area(ax, ay, bx, by, cx, cy) > EPS_AREA &&
      tri2Area(ax, ay, cx, cy, dx, dy) > EPS_AREA;
    if (okAC) return true;
    return (
      tri2Area(ax, ay, bx, by, dx, dy) > EPS_AREA &&
      tri2Area(bx, by, cx, cy, dx, dy) > EPS_AREA
    );
  };
  const unsnap = (vi: number) => {
    snapped[vi] = 0;
    posX[vi] = gridX[vi];
    posY[vi] = gridY[vi];
  };
  for (let repair = 0; repair < 2; repair++) {
    // collapsed cells (all four corners on one line)
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        if (state[fy * fw + fx] !== 1) continue;
        const iTL = fy * vw + fx;
        const iTR = iTL + 1;
        const iBL = (fy + 1) * vw + fx;
        const iBR = iBL + 1;
        if (quadEmittable(iTL, iTR, iBR, iBL)) continue;
        for (const vi of [iTL, iTR, iBR, iBL]) if (snapped[vi]) unsnap(vi);
      }
    }
    // Vertices snapped onto the same point as another vertex: a zero-length
    // edge, and walls from both vertices meeting on one vertical edge (a
    // bowtie) — at shape corners several vertices project onto the same
    // boundary point. Keep the first snap and revert the others; reverting
    // always lands on a unique grid position, so a couple of passes settle
    // every collision.
    const byPos = new Map<string, number>();
    for (let vi = 0; vi < vw * vh; vi++) {
      if (!snapped[vi]) continue;
      const key = posX[vi].toFixed(6) + "," + posY[vi].toFixed(6);
      const first = byPos.get(key);
      if (first === undefined) byPos.set(key, vi);
      else unsnap(vi);
    }
  }

  // Emit a quad whose world-space XY come from the (possibly snapped) vertex
  // arrays; picks the diagonal that keeps both triangles non-degenerate.
  const emitQuad = (
    ia: number,
    ib: number,
    ic: number,
    id: number,
    za: number,
    zb: number,
    zc: number,
    zd: number,
    flip: boolean
  ): void => {
    const ax = posX[ia], ay = posY[ia];
    const bx = posX[ib], by = posY[ib];
    const cx = posX[ic], cy = posY[ic];
    const dx = posX[id], dy = posY[id];
    const area = (
      x0: number, y0: number,
      x1: number, y1: number,
      x2: number, y2: number
    ): number => Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
    const a0 = area(ax, ay, bx, by, cx, cy);
    const a1 = area(ax, ay, cx, cy, dx, dy);
    if (a0 > EPS_AREA && a1 > EPS_AREA) {
      if (flip) {
        pushTri(out, ax, ay, za, cx, cy, zc, bx, by, zb);
        pushTri(out, ax, ay, za, dx, dy, zd, cx, cy, zc);
      } else {
        pushTri(out, ax, ay, za, bx, by, zb, cx, cy, zc);
        pushTri(out, ax, ay, za, cx, cy, zc, dx, dy, zd);
      }
      return;
    }
    // try the other diagonal (B-D)
    const a2 = area(ax, ay, bx, by, dx, dy);
    const a3 = area(bx, by, cx, cy, dx, dy);
    if (a2 > EPS_AREA && a3 > EPS_AREA) {
      if (flip) {
        pushTri(out, ax, ay, za, dx, dy, zd, bx, by, zb);
        pushTri(out, bx, by, zb, dx, dy, zd, cx, cy, zc);
      } else {
        pushTri(out, ax, ay, za, bx, by, zb, dx, dy, zd);
        pushTri(out, bx, by, zb, cx, cy, zc, dx, dy, zd);
      }
    }
  };

  // Face-run merging (triangle-count reduction): consecutive solid cells of a
  // row with identical flat z (or locally constant smooth sheets) and no
  // snapped corners collapse into one quad pair. A break anywhere in a
  // column must be mirrored by every row whose faces share that column's
  // vertical edges, otherwise merged faces leave T-junction holes — so the
  // per-column break set is the union over ALL rows of that column's
  // cell-level transitions (z change, solidity change, snapped corner) AND
  // of every wall segment on the row boundaries: walls are emitted per fine
  // cell, so a run may never skip a vertex column that a silhouette wall or
  // a z-step wall ends at.
  // Rows merge only between break columns; the silhouette, ring contour and
  // z steps keep their full fine resolution.
  const hasSnapCorner = new Uint8Array(fw * fh);
  for (let fy = 0; fy < fh; fy++) {
    for (let fx = 0; fx < fw; fx++) {
      const i = fy * fw + fx;
      if (state[i] !== 1) continue;
      const iTL = fy * vw + fx;
      const iTR = iTL + 1;
      const iBL = (fy + 1) * vw + fx;
      const iBR = iBL + 1;
      if (snapped[iTL] || snapped[iTR] || snapped[iBL] || snapped[iBR]) {
        hasSnapCorner[i] = 1;
      }
    }
  }
  const colBreak = new Uint8Array(fw);
  for (let fy = 0; fy < fh; fy++) {
    for (let fx = 0; fx < fw; fx++) {
      const i = fy * fw + fx;
      if (state[i] === 1 && hasSnapCorner[i]) {
        colBreak[fx] = 1;
        if (fx > 0) colBreak[fx - 1] = 1;
        continue;
      }
      if (fx === 0) continue;
      const j = i - 1;
      if (state[i] !== 1 || state[j] !== 1) {
        colBreak[fx] = 1;
        continue;
      }
      if (smooth) {
        // Compare the sheet values at BOTH vertex rows this cell spans:
        // the run extension tests all four corners, so a sheet change at
        // either vertex row must force a break here (and in every other
        // row, via the union) or a neighbouring run would merge across.
        const aTL = fy * vw + fx;
        const bTL = aTL - 1;
        const aBL = aTL + vw;
        const bBL = bTL + vw;
        if (
          sheets!.v0[aTL] !== sheets!.v0[bTL] ||
          sheets!.v1[aTL] !== sheets!.v1[bTL] ||
          sheets!.v0[aBL] !== sheets!.v0[bBL] ||
          sheets!.v1[aBL] !== sheets!.v1[bBL]
        ) {
          colBreak[fx] = 1;
        }
      } else if (fz0[i] !== fz0[j] || fz1[i] !== fz1[j]) {
        colBreak[fx] = 1;
      }
    }
  }
  // Row-to-row transitions: a wall on a horizontal grid line (silhouette
  // wall against empty space, or z-step wall between two solid rows) is
  // emitted per fine cell. A run in either bordering row must keep every
  // vertex column the wall touches — break at both ends of each wall
  // segment, or the run's long edge and the wall's short edges become
  // T-junctions (boundary edges = non-manifold to a slicer).
  for (let fy = 0; fy <= fh; fy++) {
    for (let fx = 0; fx < fw; fx++) {
      const aIdx = fy > 0 ? (fy - 1) * fw + fx : -1; // north cell
      const bIdx = fy < fh ? fy * fw + fx : -1; // south cell
      const as = aIdx >= 0 && state[aIdx] === 1;
      const bs = bIdx >= 0 && state[bIdx] === 1;
      if (!as && !bs) continue;
      let wall = as !== bs;
      if (!wall && !smooth) {
        wall = fz0[aIdx] !== fz0[bIdx] || fz1[aIdx] !== fz1[bIdx];
      }
      if (!wall) continue;
      colBreak[fx] = 1;
      if (fx + 1 < fw) colBreak[fx + 1] = 1;
    }
  }
  for (let fy = 0; fy < fh; fy++) {
    let fx = 0;
    while (fx < fw) {
      const i = fy * fw + fx;
      if (state[i] !== 1) {
        fx++;
        continue;
      }
      const z0 = smooth ? sheets!.v0[fy * vw + fx] : fz0[i];
      const z1 = smooth ? sheets!.v1[fy * vw + fx] : fz1[i];
      let runEnd = fx + 1;
      while (runEnd < fw) {
        const j = fy * fw + runEnd;
        if (
          state[j] !== 1 ||
          hasSnapCorner[j] ||
          colBreak[runEnd] ||
          (smooth
            ? sheets!.v0[fy * vw + runEnd] !== z0 ||
              sheets!.v0[fy * vw + runEnd + 1] !== z0 ||
              sheets!.v0[(fy + 1) * vw + runEnd] !== z0 ||
              sheets!.v0[(fy + 1) * vw + runEnd + 1] !== z0 ||
              sheets!.v1[fy * vw + runEnd] !== z1 ||
              sheets!.v1[fy * vw + runEnd + 1] !== z1 ||
              sheets!.v1[(fy + 1) * vw + runEnd] !== z1 ||
              sheets!.v1[(fy + 1) * vw + runEnd + 1] !== z1
            : fz0[j] !== z0 || fz1[j] !== z1)
        ) {
          break;
        }
        runEnd++;
      }
      const iTL = fy * vw + fx;
      const iTR = fy * vw + runEnd;
      const iBL = (fy + 1) * vw + fx;
      const iBR = (fy + 1) * vw + runEnd;
      if (smooth) {
        const { v0, v1 } = sheets!;
        emitQuad(iBL, iBR, iTR, iTL, v1[iBL], v1[iBR], v1[iTR], v1[iTL], false);
        emitQuad(iBL, iBR, iTR, iTL, v0[iBL], v0[iBR], v0[iTR], v0[iTL], true);
      } else {
        emitQuad(iBL, iBR, iTR, iTL, z1, z1, z1, z1, false);
        emitQuad(iBL, iBR, iTR, iTL, z0, z0, z0, z0, true);
      }
      fx = runEnd;
    }
  }

  // Side walls. Smooth mode: walls only between solid and non-solid fine
  // cells, spanning the per-vertex interpolated sheets (solid neighbours
  // share those sheet values, so no step faces are needed). Flat mode: for
  // every fine-grid edge, emit z strips that are solid in exactly one of
  // the two cells — this covers silhouette walls, transparent-pixel walls,
  // and z-step faces between adjacent solid cells of different heights,
  // keeping every mesh edge shared by exactly two triangles.
  const wallSegment = (ai: number, bi: number, solidOnA: boolean): void => {
    // guard: snapping can collapse a wall to zero width (e.g. at a sharp
    // star tip where both edge vertices project to the same boundary point)
    if (
      Math.abs(posX[ai] - posX[bi]) < 1e-9 &&
      Math.abs(posY[ai] - posY[bi]) < 1e-9
    ) {
      return;
    }
    const { v0, v1 } = sheets!;
    const z0a = v0[ai], z1a = v1[ai];
    const z0b = v0[bi], z1b = v1[bi];
    if (solidOnA) {
      pushTri(out, posX[ai], posY[ai], z0a, posX[bi], posY[bi], z0b, posX[bi], posY[bi], z1b);
      pushTri(out, posX[ai], posY[ai], z0a, posX[bi], posY[bi], z1b, posX[ai], posY[ai], z1a);
    } else {
      pushTri(out, posX[ai], posY[ai], z0a, posX[bi], posY[bi], z1b, posX[bi], posY[bi], z0b);
      pushTri(out, posX[ai], posY[ai], z0a, posX[ai], posY[ai], z1a, posX[bi], posY[bi], z1b);
    }
  };

  if (smooth) {
    // vertical (east-west) boundaries
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const i = fy * fw + fx;
        if (state[i] !== 1) continue;
        if (cell(fx - 1, fy) !== 1) {
          const vi = fy * vw + fx; // west edge: top vertex vi, bottom vi+vw
          wallSegment(vi, vi + vw, true);
        }
        if (cell(fx + 1, fy) !== 1) {
          const vi = fy * vw + fx + 1; // east edge, outward +X
          wallSegment(vi + vw, vi, true);
        }
      }
    }

    // horizontal (north-south) boundaries
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const i = fy * fw + fx;
        if (state[i] !== 1) continue;
        if (cell(fx, fy - 1) !== 1) {
          const vi = fy * vw + fx; // north edge, outward +Y
          wallSegment(vi, vi + 1, true);
        }
        if (cell(fx, fy + 1) !== 1) {
          const vi = (fy + 1) * vw + fx; // south edge, outward -Y
          wallSegment(vi + 1, vi, true);
        }
      }
    }
  } else {
    // For a fine-grid edge between cell intervals [a0,a1] and [b0,b1]
    // (non-solid cell = no interval), emit a wall strip for every global-cut
    // strip that is solid in exactly one of the two cells. `ai`/`bi` are the
    // edge's vertex indices, ordered so faces point away from the solid side.
    const stripsBetween = (
      aSolid: boolean,
      a0: number,
      a1: number,
      bSolid: boolean,
      b0: number,
      b1: number,
      ai: number,
      bi: number
    ): void => {
      // guard: snapping can collapse a wall to zero width (sharp corners)
      if (
        Math.abs(posX[ai] - posX[bi]) < 1e-9 &&
        Math.abs(posY[ai] - posY[bi]) < 1e-9
      ) {
        return;
      }
      for (let c = 0; c + 1 < cuts.length; c++) {
        const lo = cuts[c];
        const hi = cuts[c + 1];
        const mid = (lo + hi) / 2;
        const inA = aSolid && a0 < mid && mid < a1;
        const inB = bSolid && b0 < mid && mid < b1;
        if (inA === inB) continue;
        if (inA) {
          // solid only west/north of the edge -> face points +X/+Y
          pushTri(out, posX[ai], posY[ai], lo, posX[bi], posY[bi], lo, posX[bi], posY[bi], hi);
          pushTri(out, posX[ai], posY[ai], lo, posX[bi], posY[bi], hi, posX[ai], posY[ai], hi);
        } else {
          // solid only east/south of the edge -> face points -X/-Y
          pushTri(out, posX[ai], posY[ai], lo, posX[bi], posY[bi], hi, posX[bi], posY[bi], lo);
          pushTri(out, posX[ai], posY[ai], lo, posX[ai], posY[ai], hi, posX[bi], posY[bi], hi);
        }
      }
    };

    // vertical (east-west) grid lines
    for (let vx = 0; vx <= fw; vx++) {
      for (let fy = 0; fy < fh; fy++) {
        const aIdx = vx > 0 ? fy * fw + vx - 1 : -1; // west cell
        const bIdx = vx < fw ? fy * fw + vx : -1; // east cell
        const as = aIdx >= 0 && state[aIdx] === 1;
        const bs = bIdx >= 0 && state[bIdx] === 1;
        if (!as && !bs) continue;
        // edge vertices: top (fy), bottom (fy+1)
        const aTop = fy * vw + vx;
        const aBot = aTop + vw;
        stripsBetween(
          as,
          as ? fz0[aIdx] : 0,
          as ? fz1[aIdx] : 0,
          bs,
          bs ? fz0[bIdx] : 0,
          bs ? fz1[bIdx] : 0,
          aTop,
          aBot
        );
      }
    }

    // horizontal (north-south) grid lines
    for (let vy = 0; vy <= fh; vy++) {
      for (let fx = 0; fx < fw; fx++) {
        const aIdx = vy > 0 ? (vy - 1) * fw + fx : -1; // north cell
        const bIdx = vy < fh ? vy * fw + fx : -1; // south cell
        const as = aIdx >= 0 && state[aIdx] === 1;
        const bs = bIdx >= 0 && state[bIdx] === 1;
        if (!as && !bs) continue;
        // edge vertices: left (fx), right (fx+1)
        const aL = vy * vw + fx;
        const aR = aL + 1;
        stripsBetween(
          as,
          as ? fz0[aIdx] : 0,
          as ? fz1[aIdx] : 0,
          bs,
          bs ? fz0[bIdx] : 0,
          bs ? fz1[bIdx] : 0,
          aL,
          aR
        );
      }
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
  pixelSize: number,
  sub = 2
): TriangleSoup {
  const out: TriangleSoup = [];
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
