// Smooth extruded-part mesh from a binary mask: marching-squares contouring
// + Chaikin smoothing + scanline caps + vertical walls (mm units, Y-flipped).
// No new dependencies; manifold enough for slicers (shared cap/wall edges).

export type TriangleSoup = number[];

function pushTri(
  out: TriangleSoup,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number
): void {
  out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
}

export type Pt = [number, number];

/** Coverage field (sub+1 grid) from a binary mask via box sampling. */
export function maskCoverage(
  mask: Uint8Array, gw: number, gh: number, sub: number
): { field: Float32Array; fw: number; fh: number } {
  const fw = gw * sub;
  const fh = gh * sub;
  const field = new Float32Array((fw + 1) * (fh + 1));
  const atM = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= gw ? gw - 1 : x;
    const cy = y < 0 ? 0 : y >= gh ? gh - 1 : y;
    return mask[cy * gw + cx];
  };
  for (let gy = 0; gy <= fh; gy++) {
    for (let gx = 0; gx <= fw; gx++) {
      const px = gx / sub - 0.5;
      const py = gy / sub - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      let s = 0;
      for (let dy = 0; dy <= 1; dy++)
        for (let dx = 0; dx <= 1; dx++) s += atM(x0 + dx, y0 + dy);
      field[gy * (fw + 1) + gx] = s / 4;
    }
  }
  return { field, fw, fh };
}

/** Marching squares (level 0.5) over a coverage field -> segments (mask px). */
export function contourSegments(
  field: Float32Array, fw: number, fh: number, sub: number
): [Pt, Pt][] {
  const F = (ix: number, iy: number): number => {
    const x = ix < 0 ? 0 : ix > fw ? fw : ix;
    const y = iy < 0 ? 0 : iy > fh ? fh : iy;
    return field[y * (fw + 1) + x];
  };
  const segs: [Pt, Pt][] = [];
  const lerp = (a: number, b: number): number => {
    const d = b - a;
    return Math.abs(d) < 1e-9 ? 0.5 : (0.5 - a) / d;
  };
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const a = F(x, y);
      const b = F(x + 1, y);
      const c = F(x + 1, y + 1);
      const d = F(x, y + 1);
      let idx = 0;
      if (a > 0.5) idx |= 8;
      if (b > 0.5) idx |= 4;
      if (c > 0.5) idx |= 2;
      if (d > 0.5) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const T: Pt = [x + lerp(a, b), y];
      const R: Pt = [x + 1, y + lerp(b, c)];
      const B: Pt = [x + lerp(d, c), y + 1];
      const L: Pt = [x, y + lerp(a, d)];
      const push = (p: Pt, q: Pt) => {
        segs.push([
          [p[0] / sub, p[1] / sub],
          [q[0] / sub, q[1] / sub],
        ]);
      };
      switch (idx) {
        case 1: push(L, B); break;
        case 2: push(B, R); break;
        case 3: push(L, R); break;
        case 4: push(R, T); break;
        case 5: push(L, T); push(B, R); break;
        case 6: push(B, T); break;
        case 7: push(L, T); break;
        case 8: push(T, L); break;
        case 9: push(T, B); break;
        case 10: push(T, R); push(L, B); break;
        case 11: push(T, R); break;
        case 12: push(R, L); break;
        case 13: push(R, B); break;
        case 14: push(B, L); break;
      }
    }
  }
  return segs;
}

/** Chain segments into closed loops (endpoint hash, 1e-6 px tolerance). */
export function chainLoops(segs: [Pt, Pt][]): Pt[][] {
  const key = (p: Pt): string =>
    `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const startMap = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const k = key(s[0]);
    const arr = startMap.get(k);
    if (arr) arr.push(i);
    else startMap.set(k, [i]);
  });
  const used = new Uint8Array(segs.length);
  const loops: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop: Pt[] = [segs[i][0], segs[i][1]];
    let guard = segs.length + 4;
    while (guard-- > 0) {
      const cand = startMap.get(key(loop[loop.length - 1]));
      let nxt = -1;
      if (cand) {
        for (const ci of cand) {
          if (!used[ci]) {
            nxt = ci;
            break;
          }
        }
      }
      if (nxt < 0) break;
      used[nxt] = 1;
      loop.push(segs[nxt][1]);
    }
    if (loop.length > 1) {
      const f = loop[0];
      const l = loop[loop.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) loop.pop();
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** RDP simplify (px tolerance) for closed loops. */
export function simplifyLoop(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 4) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const dist = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - (a[0] + dx * c), p[1] - (a[1] + dy * c));
  };
  while (stack.length) {
    const [s0, s1] = stack.pop()!;
    let dMax = 0;
    let idx = -1;
    for (let i = s0 + 1; i < s1; i++) {
      const d = dist(pts[i], pts[s0], pts[s1]);
      if (d > dMax) {
        dMax = d;
        idx = i;
      }
    }
    if (idx >= 0 && dMax > tol) {
      keep[idx] = 1;
      stack.push([s0, idx], [idx, s1]);
    }
  }
  const r: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) r.push(pts[i]);
  return r.length >= 3 ? r : pts.slice();
}

/** Closed-loop Chaikin smoothing (keeps loops closed). */
export function chaikinClosed(pts: Pt[]): Pt[] {
  const r: Pt[] = [];
  const nl = pts.length;
  for (let i = 0; i < nl; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % nl];
    r.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
    r.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
  }
  return r;
}

/**
 * Extrude smooth loops to a triangle soup (mm units, row 0 -> max Y).
 * Caps use even-odd scanline fill between loop crossings; walls are split
 * at `zCuts` so stacked text parts share segment boundaries.
 */
export function extrudeLoops(
  loops: Pt[][],
  gw: number,
  gh: number,
  pixelSize: number,
  z0: number,
  z1: number,
  zCuts: number[] = []
): TriangleSoup {
  const out: TriangleSoup = [];
  const mm = loops.map((l) =>
    l.map(([x, y]): Pt => [x * pixelSize, (gh - y) * pixelSize])
  );
  const V: Pt[] = [];
  const vIndex = new Map<string, number>();
  const VERT = (p: Pt): number => {
    const k = `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
    const hit = vIndex.get(k);
    if (hit !== undefined) return hit;
    V.push(p);
    const idx = V.length - 1;
    vIndex.set(k, idx);
    return idx;
  };
  const ySet = new Set<number>();
  for (const l of mm)
    for (const p of l) ySet.add(Math.round(p[1] * 1e5) / 1e5);
  const ys = [...ySet].sort((a, b) => a - b);
  const EPSY = pixelSize * 1e-4;
  interface Tri { a: number; b: number; c: number }
  const capTris: Tri[] = [];
  for (let yi = 0; yi + 1 < ys.length; yi++) {
    const ya = ys[yi];
    const yb = ys[yi + 1];
    if (yb - ya < EPSY) continue;
    const ym = (ya + yb) / 2;
    const xs: number[] = [];
    for (const l of mm) {
      for (let i = 0; i < l.length; i++) {
        const p = l[i];
        const q = l[(i + 1) % l.length];
        if ((p[1] <= ym) !== (q[1] <= ym)) {
          const t = (ym - p[1]) / (q[1] - p[1]);
          xs.push(p[0] + (q[0] - p[0]) * t);
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = xs[k];
      const xb = xs[k + 1];
      if (xb - xa < EPSY) continue;
      const ia0 = VERT([xa, ya]);
      const ib0 = VERT([xb, ya]);
      const ia1 = VERT([xa, yb]);
      const ib1 = VERT([xb, yb]);
      capTris.push({ a: ia0, b: ib0, c: ib1 }, { a: ia0, b: ib1, c: ia1 });
    }
  }
  for (const t of capTris) {
    const A = V[t.a];
    const B = V[t.b];
    const C = V[t.c];
    pushTri(out, A[0], A[1], z1, B[0], B[1], z1, C[0], C[1], z1);
    pushTri(out, A[0], A[1], z0, C[0], C[1], z0, B[0], B[1], z0);
  }
  const cuts = zCuts
    .filter((z) => z > z0 + 1e-9 && z < z1 - 1e-9)
    .sort((a, b) => a - b);
  const levels = [z0, ...cuts, z1];
  // Orient loops by nesting depth: even depth = outer (CCW, interior left),
  // odd depth = hole (CW). With CCW orientation the wall winding below yields
  // outward normals; holes reversed yield normals pointing into the hole
  // (i.e. outward from the material).
  const signedArea = (l: Pt[]): number => {
    let a = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const q = l[(i + 1) % l.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };
  const pointInLoop = (pt: Pt, l: Pt[]): boolean => {
    let inside = false;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const q = l[(i + 1) % l.length];
      if ((p[1] <= pt[1]) !== (q[1] <= pt[1])) {
        const x = p[0] + ((pt[1] - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
        if (x > pt[0]) inside = !inside;
      }
    }
    return inside;
  };
  for (const l of mm) {
    let depth = 0;
    for (const o of mm) {
      if (o === l || o.length < 3) continue;
      if (pointInLoop(l[0], o)) depth++;
    }
    const wantCCW = depth % 2 === 0;
    const isCCW = signedArea(l) > 0;
    if (wantCCW !== isCCW) l.reverse();
  }
  for (const l of mm) {
    for (let i = 0; i < l.length; i++) {
      const P0 = l[i];
      const P1 = l[(i + 1) % l.length];
      if (
        Math.abs(P0[0] - P1[0]) < 1e-9 &&
        Math.abs(P0[1] - P1[1]) < 1e-9
      )
        continue;
      for (let c = 0; c + 1 < levels.length; c++) {
        const lo = levels[c];
        const hi = levels[c + 1];
        // Loop orientation (outer CCW / hole CW) is normalized above, so
        // this winding yields outward-from-material normals for both.
        pushTri(out, P0[0], P0[1], lo, P1[0], P1[1], lo, P1[0], P1[1], hi);
        pushTri(out, P0[0], P0[1], lo, P1[0], P1[1], hi, P0[0], P0[1], hi);
      }
    }
  }
  return out;
}

/** Full pipeline: mask -> smooth loop extrusion. */
export function buildSmoothExtrudedGeometry(
  mask: Uint8Array,
  gw: number,
  gh: number,
  pixelSize: number,
  z0: number,
  z1: number,
  zCuts: number[] = []
): TriangleSoup {
  if (z1 <= z0 + 1e-9) return [];
  const sub = 2;
  const { field, fw, fh } = maskCoverage(mask, gw, gh, sub);
  const loops = chainLoops(contourSegments(field, fw, fh, sub));
  if (!loops.length) return [];
  const smooth = loops.map((l) => {
    let p = simplifyLoop(l, 0.12);
    for (let i = 0; i < 2; i++) p = chaikinClosed(p);
    return p;
  });
  return extrudeLoops(smooth, gw, gh, pixelSize, z0, z1, zCuts);
}

