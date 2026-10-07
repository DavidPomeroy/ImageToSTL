// Dev tool: trace a filled silhouette from a reference image (dark outline on
// a light background) into a unit-space polygon for lib/shapes.ts. Used to
// derive the "leaf" and "maple" outlines.
//
// Usage: npx tsx scripts/trace-shape.ts <image> [--ink 140] [--eps 0.006]
//
// Requires `sharp` (already present via Next.js) and is dev-only: it is not
// part of the app bundle or the test suite.
import sharp from "sharp";

interface Pt {
  x: number;
  y: number;
}

function parseArg(name: string, dflt: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : dflt;
}

async function insideMask(file: string, inkThreshold: number) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gw = info.width;
  const gh = info.height;
  const ink = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    const o = i * 4;
    const a = data[o + 3];
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    ink[i] = a >= 128 && lum < inkThreshold ? 1 : 0;
  }
  // Flood the background in from the border over non-ink pixels; anything the
  // flood cannot reach is inside the silhouette.
  const bg = new Uint8Array(gw * gh);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= gw || y >= gh) return;
    const i = y * gw + x;
    if (bg[i] || ink[i]) return;
    bg[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < gw; x++) {
    push(x, 0);
    push(x, gh - 1);
  }
  for (let y = 0; y < gh; y++) {
    push(0, y);
    push(gw - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % gw;
    const y = (i - x) / gw;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  const inside = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) inside[i] = bg[i] ? 0 : 1;
  return { inside, gw, gh };
}

/** Chain the directed crack boundary of the inside region into vertex loops. */
function traceLoops(inside: Uint8Array, gw: number, gh: number): Pt[][] {
  const vw = gw + 1;
  const vid = (x: number, y: number) => y * vw + x;
  // Directed edges keyed by start vertex. TL -> TR -> BR -> BL is clockwise
  // on screen (y down), i.e. CCW in unit space (+Y up).
  const out = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    if (!out.has(a)) out.set(a, []);
    out.get(a)!.push(b);
  };
  const isIn = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < gw && y < gh && inside[y * gw + x] === 1;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!isIn(x, y)) continue;
      const TL = vid(x, y);
      const TR = vid(x + 1, y);
      const BR = vid(x + 1, y + 1);
      const BL = vid(x, y + 1);
      if (!isIn(x, y - 1)) add(TL, TR);
      if (!isIn(x + 1, y)) add(TR, BR);
      if (!isIn(x, y + 1)) add(BR, BL);
      if (!isIn(x - 1, y)) add(BL, TL);
    }
  }
  const loops: Pt[][] = [];
  const used = new Set<string>();
  const key = (a: number, b: number) => a + ">" + b;
  for (const [a, list] of out) {
    for (const b0 of list) {
      if (used.has(key(a, b0))) continue;
      const loop: number[] = [a];
      let cur = a;
      let next = b0;
      let guard = 0;
      while (next !== a && guard++ < gw * gh * 4 + 8) {
        used.add(key(cur, next));
        loop.push(next);
        cur = next;
        const cand = out.get(cur) ?? [];
        if (cand.length === 0) break;
        next = cand.find((v) => !used.has(key(cur, v))) ?? cand[0];
      }
      used.add(key(cur, next));
      if (loop.length >= 4) {
        loops.push(
          loop.map((v) => {
            const x = v % vw;
            return { x, y: (v - x) / vw };
          })
        );
      }
    }
  }
  loops.sort((p, q) => q.length - p.length);
  return loops;
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = pts[i0];
    const b = pts[i1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > eps && best !== -1) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Drop near-duplicate vertices (including the wrap-around pair). */
function dedupe(pts: Pt[], minStep = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length) {
      const q = out[out.length - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y) < minStep) continue;
    }
    out.push(p);
  }
  while (out.length > 1) {
    const q = out[0];
    const p = out[out.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) < minStep) out.pop();
    else break;
  }
  return out;
}

/** Same self-crossing / doubled-back-edge test as test-core.ts. */
const segsMeet = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) > 1e-12) {
    const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / denom;
    const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / denom;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  }
  const len1 = Math.hypot(d1x, d1y);
  if (len1 < 1e-9) return false;
  if (Math.abs((c.x - a.x) * d1y - (c.y - a.y) * d1x) / len1 > 1e-9) {
    return false;
  }
  const ux = d1x / len1;
  const uy = d1y / len1;
  const proj = (p: Pt) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const lo = Math.max(0, Math.min(proj(c), proj(d)));
  const hi = Math.min(len1, Math.max(proj(c), proj(d)));
  return hi - lo > 1e-9;
};

function crossings(pts: Pt[]): number {
  const n = pts.length;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if ((i + 1) % n === j || (j + 1) % n === i) continue;
      if (segsMeet(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) bad++;
    }
  }
  return bad;
}


async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx scripts/trace-shape.ts <image>");
    process.exit(1);
  }
  const ink = parseArg("--ink", 140);
  const eps = parseArg("--eps", 0.004);
  const { inside, gw, gh } = await insideMask(file, ink);
  const loops = traceLoops(inside, gw, gh);
  console.log(
    "image " + gw + "x" + gh + ", loops: " + loops.map((l) => l.length).join(", ")
  );
  const loop = loops[0];
  if (!loop) {
    console.error("no loop found");
    process.exit(1);
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of loop) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const s = Math.max(maxX - minX, maxY - minY) / 2;
  const unit: Pt[] = loop.map((p) => ({
    x: (p.x - cx) / s,
    y: (cy - p.y) / s,
  }));

  // RDP is for open polylines: split the closed loop at its two farthest-apart
  // vertices so simplification never collapses the "seam".
  let far = 0;
  let farD = -1;
  for (let i = 0; i < unit.length; i++) {
    const d = Math.hypot(unit[i].x - unit[0].x, unit[i].y - unit[0].y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const seg1 = unit.slice(0, far + 1);
  const seg2 = [...unit.slice(far), unit[0]];
  const simplified = dedupe([
    ...rdp(seg1, eps).slice(0, -1),
    ...rdp(seg2, eps).slice(0, -1),
  ]);

  console.log(
    "bbox px " +
      (maxX - minX).toFixed(0) +
      "x" +
      (maxY - minY).toFixed(0) +
      ", vertices " +
      unit.length +
      " -> " +
      simplified.length +
      ", crossings " +
      crossings(simplified)
  );
  console.log("--- polygon ---");
  for (const p of simplified) {
    console.log(`        [${p.x.toFixed(4)}, ${p.y.toFixed(4)}],`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


