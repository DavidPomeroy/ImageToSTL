// Text-sign geometry: freestanding outlined text (two-colour name plate).
//
// The glyph is rasterized to a binary mask on an offscreen canvas, then:
//  - background part = glyph dilated by `outlineMm` (the visible rim),
//  - foreground part = glyph eroded by `insetMm` (the raised inner section).
// Both parts are extruded from their masks by `smoothExtrude` (marching-squares
// contours + smoothing, so no pixel stepping), sharing the exporters and the
// 3D preview with the image page.

import { buildSmoothExtrudedGeometry } from "./smoothExtrude";
import { buildHeightfieldGeometry, type TriangleSoup } from "./mesh";
import { rgbToHex, type RGB } from "./quantize";

export interface TextSignInput {
  /** Raw text; newlines split into multiple lines. */
  text: string;
  /** CSS font-family to render with (must already be loaded). */
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  /** Scale factor for the very first character (drop-cap effect, 1 = off). */
  firstLetterScale: number;
  /** Line height multiplier. */
  lineHeight: number;
  /** Total object width incl. outline, mm. */
  widthMm: number;
  /** Outline rim: dilation radius around the glyph, mm. */
  outlineMm: number;
  /** Inner inset: erosion radius inside the glyph, mm. */
  insetMm: number;
  /** Height of the background (outline) part, mm. */
  baseHeightMm: number;
  /** Extra height of the raised inner section, mm. */
  topHeightMm: number;
  /** Raster resolution: mm per pixel (0.12–0.25 recommended). */
  pixelMm: number;
}

export interface TextSignMesh {
  color: RGB;
  name: string;
  pixelCount: number;
  z0: number;
  z1: number;
  positions: TriangleSoup;
}

export interface TextSignResult {
  meshes: TextSignMesh[];
  gw: number;
  gh: number;
  pixelSizeMm: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  triangleCount: number;
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  /** Binary masks (row-major) for the 2D preview. */
  outlineMask: Uint8Array;
  innerMask: Uint8Array;
  glyphMask: Uint8Array;
  warnings: string[];
}

/** Chamfer distance transform (in pixels) to the nearest zero pixel. */
export function chamferToZero(
  mask: Uint8Array,
  gw: number,
  gh: number
): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(gw * gh);
  for (let i = 0; i < mask.length; i++) d[i] = mask[i] ? INF : 0;
  const SQ2 = Math.SQRT2;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 1);
      if (y > 0) {
        m = Math.min(m, d[i - gw] + 1);
        if (x > 0) m = Math.min(m, d[i - gw - 1] + SQ2);
        if (x + 1 < gw) m = Math.min(m, d[i - gw + 1] + SQ2);
      }
      d[i] = m;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x + 1 < gw) m = Math.min(m, d[i + 1] + 1);
      if (y + 1 < gh) {
        m = Math.min(m, d[i + gw] + 1);
        if (x + 1 < gw) m = Math.min(m, d[i + gw + 1] + SQ2);
        if (x > 0) m = Math.min(m, d[i + gw - 1] + SQ2);
      }
      d[i] = m;
    }
  }
  return d;
}

/** Owner component of letter i's ink (first labelled ink pixel). */
export function letterOwner(
  mm: Uint8Array,
  label: Int32Array
): number {
  for (let p = 0; p < mm.length; p++) {
    if (mm[p] && label[p] !== -1) return label[p];
  }
  return -1;
}

/** BFS background-to-background path length from component 0. */
export function bgGapLength(
  w: number,
  h: number,
  solidAt: (p: number) => boolean,
  label: Int32Array
): number {
  const prev = new Int32Array(w * h).fill(-1);
  const q: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (solidAt(p) && label[p] === 0) {
      prev[p] = p;
      q.push(p);
    }
  }
  let head = 0;
  let found = -1;
  while (head < q.length && found < 0) {
    const c = q[head++];
    const cx = c % w;
    const cy = (c / w) | 0;
    for (let dy = -1; dy <= 1 && found < 0; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (prev[ni] !== -1) continue;
        prev[ni] = c;
        if (solidAt(ni)) {
          if (label[ni] !== 0) found = ni;
        } else {
          q.push(ni);
        }
      }
    }
  }
  if (found < 0) return 0;
  let len = 0;
  for (let c = found; prev[c] !== c; c = prev[c]) {
    len++;
    if (prev[c] < 0 || len > w * h) break;
  }
  return len;
}

/** Verify pass: rasterize each letter, dilate each by rOut, and while the
 * union has > 1 component shift the first separated letter (+ followers)
 * left by the measured background gap. Mutates `off`. */
export function closeBackgroundGaps(
  seq: { ch: string; px: number }[],
  infos: { il: number | null; ir: number | null }[],
  nat: number[],
  off: number[],
  inkIdx: number[],
  ascent: number,
  descent: number,
  rOutPx: number,
  style: string,
  fontFamily: string
): void {
  if (inkIdx.length < 2) return;
  const H = Math.max(8, Math.ceil(ascent + descent + rOutPx * 4 + 8));
  const tmpC = document.createElement("canvas");
  for (let iter = 0; iter < 12; iter++) {
    let l = Infinity;
    let r = -Infinity;
    for (let i = 0; i < seq.length; i++) {
      const g = infos[i];
      if (g.il === null || g.ir === null) continue;
      l = Math.min(l, nat[i] - off[i] + g.il);
      r = Math.max(r, nat[i] - off[i] + g.ir);
    }
    if (!isFinite(l)) break;
    const w = Math.max(8, Math.ceil(r - l + rOutPx * 4 + 8));
    tmpC.width = w;
    tmpC.height = H;
    const tctx = tmpC.getContext("2d", { willReadFrequently: true })!;
    const baseY = rOutPx * 2 + 4 + ascent;
    const masks: (Uint8Array | null)[] = seq.map((e, i) => {
      if (infos[i].il === null) return null;
      tctx.fillStyle = "#000";
      tctx.fillRect(0, 0, w, H);
      tctx.fillStyle = "#fff";
      tctx.textBaseline = "alphabetic";
      tctx.font = `${style}${e.px}px ${fontFamily}`;
      tctx.fillText(e.ch, nat[i] - off[i] - l + rOutPx * 2 + 4, baseY);
      const dd = tctx.getImageData(0, 0, w, H).data;
      const mm = new Uint8Array(w * H);
      for (let p = 0; p < mm.length; p++) mm[p] = dd[p * 4] >= 128 ? 1 : 0;
      return mm;
    });
    const bgs: (Uint8Array | null)[] = masks.map((mm) => {
      if (!mm) return null;
      const inv = new Uint8Array(w * H);
      for (let p = 0; p < inv.length; p++) inv[p] = mm[p] ? 0 : 1;
      const d = chamferToZero(inv, w, H);
      const o = new Uint8Array(w * H);
      for (let p = 0; p < o.length; p++)
        o[p] = mm[p] || d[p] <= rOutPx + 1e-6 ? 1 : 0;
      return o;
    });
    const solidAt = (p: number): boolean => {
      for (const b of bgs) if (b && b[p]) return true;
      return false;
    };
    const label = new Int32Array(w * H).fill(-1);
    let comps = 0;
    const stack: number[] = [];
    for (let p = 0; p < w * H; p++) {
      if (!solidAt(p) || label[p] !== -1) continue;
      label[p] = comps;
      stack.push(p);
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % w;
        const cy = (c / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= H) continue;
            const ni = ny * w + nx;
            if (label[ni] !== -1 || !solidAt(ni)) continue;
            label[ni] = comps;
            stack.push(ni);
          }
        }
      }
      comps++;
    }
    if (comps <= 1) break;
    const gapLen = bgGapLength(w, H, solidAt, label);
    if (gapLen <= 0) break;
    let boundary = -1;
    for (const i of inkIdx) {
      const mm = masks[i];
      if (!mm) continue;
      const comp = letterOwner(mm, label);
      if (comp !== 0 && comp !== -1) {
        boundary = i;
        break;
      }
    }
    if (boundary < 0) break;
    const shift = gapLen;
    if (shift < 0.5) break;
    for (let j = boundary; j < seq.length; j++) off[j] += shift;
  }
}
/** Rasterize the text to a binary glyph mask.
 * The enlarged first letter is stroke-compensated: drawn at
 * `firstLetterScale` size but thinned (eroded) by `(s-1)*Hn` so its stroke
 * width matches the other letters. `firstMask` marks the compensated
 * glyph's ink. Because the glyph itself is normalised, outline dilation
 * and inner erosion stay uniform everywhere. */
export function rasterizeText(
  input: TextSignInput,
  pxPerMm: number
): { mask: Uint8Array; firstMask: Uint8Array | null; gw: number; gh: number } {
  const lines = input.text.split("\n").map((l) => (l === "" ? " " : l));
  const style = `${input.italic ? "italic " : ""}${input.bold ? "700 " : "400 "}`;
  const REF = 100;
  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = `${style}${REF}px ${input.fontFamily}`;
  // Split the line's first character (grapheme) so it can be drawn larger.
  const splitFirst = (line: string): [string, string] => {
    if (!line) return ["", ""];
    const chars = Array.from(line);
    return [chars[0] ?? "", chars.slice(1).join("")];
  };
  const scaleOf = (li: number) =>
    li === 0 && (input.firstLetterScale ?? 1) > 1.001
      ? input.firstLetterScale
      : 1;
  // Base font size: fit the widest line's ADVANCE width into the target.
  // The enlarged first letter counts at its scaled advance so the whole
  // object (incl. drop cap) still fits `widthMm`.
  // Letter spacing is fully automatic: natural pen positions use plain
  // font advances; the join pass below tightens per-gap as needed so every
  // letter's outline background touches its neighbours.
  const scaledWidths = lines.map((l, li) => {
    const s = scaleOf(li);
    if (s === 1) return meas.measureText(l).width;
    const [f, r] = splitFirst(l);
    const advF = f === "" ? 0 : meas.measureText(f).width;
    const advR = r === "" ? 0 : meas.measureText(r).width;
    return advF * s + advR;
  });
  const targetPx = Math.max(1, input.widthMm * pxPerMm);
  const margin = Math.ceil(input.outlineMm * pxPerMm) + 4;
  const fontPx = Math.max(
    8,
    ((targetPx - margin * 2) / Math.max(1, ...scaledWidths)) * REF
  );
  meas.font = `${style}${fontPx}px ${input.fontFamily}`;
  const k = fontPx / REF;
  const lineH = REF * input.lineHeight * k;
  // Connectivity: the background part is the glyph dilated by outlineMm. Two
  // neighbouring ink pixels join into one object iff their distance is <=
  // 2*rOut, so cap every inter-letter / inter-line ink gap at
  // (2*rOut - bridge) and only ever tighten (never loosen, never overlap ink).
  // This yields per-gap spacing: wide pairs are pulled together, tight pairs
  // keep their natural font-advance spacing.
  const rOutPx = input.outlineMm * pxPerMm;
  const connectTarget = Math.max(0, 2 * rOutPx - 1.5);
  // Exact ink edges per glyph at its draw size: rasterize once and scan.
  // (Canvas metrics alone miss italic overhang / script swashes.)
  // Rows are stored per baseline-relative offset so inter-letter gaps are
  // measured on truly overlapping rows — bounding-box gaps underestimate
  // the visible gap (e.g. a swash vs a lower-case body) and leave islands.
  interface GlyphInk {
    adv: number;
    il: number | null;
    ir: number | null;
    asc: number;
    desc: number;
    /** pen-relative ink interval per baseline offset row. */
    rows: Map<number, [number, number]>;
  }
  const inkCache = new Map<string, GlyphInk>();
  const tmp = document.createElement("canvas").getContext("2d")!;
  const glyphInfo = (ch: string, px: number): GlyphInk => {
    const key = `${px.toFixed(2)}|${ch}`;
    const hit = inkCache.get(key);
    if (hit) return hit;
    meas.font = `${style}${px}px ${input.fontFamily}`;
    const m = meas.measureText(ch);
    const adv = m.width;
    const asc = m.actualBoundingBoxAscent ?? px * 0.8;
    const desc = m.actualBoundingBoxDescent ?? px * 0.2;
    let info: GlyphInk;
    if (ch === " " || ch === "\u00a0") {
      info = { adv, il: null, ir: null, asc, desc, rows: new Map() };
    } else {
      const pad = Math.ceil(px * 0.35) + 4;
      const W = Math.max(8, Math.ceil(Math.max(adv, m.actualBoundingBoxRight ?? adv) + pad * 2 + px * 0.3));
      const H = Math.max(8, Math.ceil(asc + desc + pad * 2));
      tmp.canvas.width = W;
      tmp.canvas.height = H;
      tmp.fillStyle = "#000";
      tmp.fillRect(0, 0, W, H);
      tmp.fillStyle = "#fff";
      tmp.textBaseline = "alphabetic";
      tmp.font = `${style}${px}px ${input.fontFamily}`;
      const penX = pad;
      const baseY = pad + asc;
      tmp.fillText(ch, penX, baseY);
      const dd = tmp.getImageData(0, 0, W, H).data;
      let minX = W;
      let maxX = -1;
      // pen-relative ink interval per canvas row, keyed by baseline offset
      // (rounded to whole layout px).
      const rows = new Map<number, [number, number]>();
      for (let y = 0; y < H; y++) {
        let a = W;
        let b = -1;
        for (let x = 0; x < W; x++) {
          if (dd[(y * W + x) * 4] >= 128) {
            if (x < a) a = x;
            if (x > b) b = x;
          }
        }
        if (b < 0) continue;
        const dy = Math.round(y - baseY);
        const iv: [number, number] = [a - penX, b + 1 - penX];
        const prev = rows.get(dy);
        rows.set(
          dy,
          prev ? [Math.min(prev[0], iv[0]), Math.max(prev[1], iv[1])] : iv
        );
        if (a < minX) minX = a;
        if (b > maxX) maxX = b;
      }
      if (maxX < 0) {
        info = { adv, il: null, ir: null, asc, desc, rows };
      } else {
        info = { adv, il: minX - penX, ir: maxX + 1 - penX, asc, desc, rows };
      }
    }
    inkCache.set(key, info);
    return info;
  };
  /** Minimum ink-to-ink gap between two glyphs at given pens, measured only
   * on rows where both glyphs have ink. Infinity if no row overlaps. */
  const rowGap = (a: GlyphInk, penA: number, b: GlyphInk, penB: number): number => {
    let gapMin = Infinity;
    const flip = b.rows.size < a.rows.size;
    const small: GlyphInk = flip ? b : a;
    const penS = flip ? penB : penA;
    const big: GlyphInk = flip ? a : b;
    const penBig = flip ? penA : penB;
    for (const [dy, iv] of small.rows) {
      const o = big.rows.get(dy);
      if (!o) continue;
      const g = flip ? penS + iv[0] - (penBig + o[1]) : penBig + o[0] - (penS + iv[1]);
      if (g < gapMin) gapMin = g;
    }
    return gapMin;
  };
  // Actual ink bounds per line at final size: measureText().width misses
  // italic overhang / swashes, and fixed ascent/descent guesses clip script
  // fonts — so measure the real boxes and fit the canvas around them.
  interface LineBox {
    line: string;
    first: string;
    rest: string;
    left: number;
    right: number;
    ascent: number;
    descent: number;
    firstScale: number;
    /** Per-character pen offsets (relative, after auto-tightening). */
    pens: number[];
    seq: { ch: string; px: number }[];
    /** Stroke compensation (px) applied to the drop cap's ink. */
    compK: number;
  }
  const boxes: LineBox[] = lines.map((line, li) => {
    const firstScale = scaleOf(li);
    const [first, rest] = splitFirst(line);
    const drawPx = fontPx * firstScale;
    const seq: { ch: string; px: number }[] =
      firstScale !== 1
        ? first !== ""
          ? [
              { ch: first, px: drawPx },
              ...Array.from(rest).map((ch) => ({ ch, px: fontPx })),
            ]
          : Array.from(rest).map((ch) => ({ ch, px: fontPx }))
        : Array.from(line).map((ch) => ({ ch, px: fontPx }));
    const infos = seq.map(({ ch, px }) => glyphInfo(ch, px));
    let ascent = 0;
    let descent = 0;
    for (const g of infos) {
      ascent = Math.max(ascent, g.asc);
      descent = Math.max(descent, g.desc);
    }
    if (seq.length === 0) return { line, first, rest, left: 0, right: 0, ascent, descent, firstScale, pens: [], seq, compK: 0 };
    // Inner text first: normalise the drop cap's stroke HERE (shrink its
    // per-row ink intervals by k = (s-1)*Hn, Hn = normal letters' median
    // half stroke width) so every later step — border dilation, spacing —
    // works on the exact ink that will be drawn. Previously the thinning
    // happened after layout, reopening gaps the join pass had just closed.
    let compK = 0;
    if (firstScale > 1.001 && infos.length > 1 && infos[0].il !== null) {
      const halves: number[] = [];
      for (let i = 1; i < infos.length; i++) {
        const g = infos[i];
        if (g.il === null) continue;
        for (const iv of g.rows.values()) halves.push(Math.max(0, (iv[1] - iv[0]) / 2));
      }
      let hn = 0;
      if (halves.length > 0) {
        halves.sort((a, b) => a - b);
        hn = halves[Math.floor(halves.length / 2)];
      }
      compK = (firstScale - 1) * hn;
      if (compK > 0.5) {
        const g0 = infos[0];
        const rows = new Map<number, [number, number]>();
        for (const [dy, iv] of g0.rows) {
          const nl = iv[0] + compK;
          const nr = iv[1] - compK;
          if (nr - nl >= 1) rows.set(dy, [nl, nr]);
        }
        let il = Infinity;
        let ir = -Infinity;
        for (const iv of rows.values()) {
          il = Math.min(il, iv[0]);
          ir = Math.max(ir, iv[1]);
        }
        infos[0] = {
          ...g0,
          rows,
          il: isFinite(il) ? il : null,
          ir: isFinite(ir) ? ir : null,
        };
      }
    }
    // Natural pen positions (plain font advances; spacing is automatic).
    const nat: number[] = new Array(seq.length);
    {
      let pen = 0;
      for (let i = 0; i < seq.length; i++) {
        nat[i] = pen;
        pen += infos[i].adv;
      }
    }
    // Join pass (inner text first, then the border): dilate EACH letter's
    // ink by the outline radius rOut and pull neighbours together until the
    // backgrounds touch. Analytical sweep first, then a verify pass on the
    // real per-letter backgrounds (see below). Per-gap, tighten-only, and
    // never overlap ink (keep >= 1px clearance).
    const off = new Array(seq.length).fill(0);
    const inkIdx: number[] = [];
    for (let i = 0; i < seq.length; i++) if (infos[i].il !== null) inkIdx.push(i);
    for (let sweep = 0; sweep < 3; sweep++) {
      for (let t = 0; t + 1 < inkIdx.length; t++) {
        const a = inkIdx[t];
        const b = inkIdx[t + 1];
        const gapNow = rowGap(infos[a], nat[a] - off[a], infos[b], nat[b] - off[b]);
        if (!isFinite(gapNow)) continue; // no shared rows — verify pass decides
        if (gapNow > connectTarget) {
          const delta = gapNow - connectTarget;
          const shift = Math.min(delta, Math.max(0, gapNow - 1));
          if (shift > 0) for (let j = b; j < seq.length; j++) off[j] += shift;
        }
      }
    }
    closeBackgroundGaps(seq, infos, nat, off, inkIdx, ascent, descent, rOutPx, style, input.fontFamily);
    const pens = nat.map((p, i) => p - off[i]);
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < seq.length; i++) {
      const g = infos[i];
      if (g.il === null || g.ir === null) continue;
      left = Math.min(left, pens[i] + g.il);
      right = Math.max(right, pens[i] + g.ir);
      ascent = Math.max(ascent, g.asc);
      descent = Math.max(descent, g.desc);
    }
    if (!isFinite(left)) {
      left = 0;
      right = 0;
    }
    meas.font = `${style}${fontPx}px ${input.fontFamily}`;
    return { line, first, rest, left, right, ascent, descent, firstScale, pens, seq, compK };
  });
  const inkW = Math.max(1, ...boxes.map((b) => b.right - b.left));
  const canvasW = Math.max(8, Math.ceil(inkW + margin * 2));
  // Stack lines: each line's ink box plus a gap so descenders/ascenders of
  // adjacent lines never overlap — but cap the ink-to-ink gap at
  // connectTarget so stacked lines also join into one background object
  // (tighten only, never overlap: clamp at >= 0).
  const natGap = (a: LineBox, b: LineBox) =>
    Math.max(2, lineH - (a.descent + b.ascent));
  const gap = (a: LineBox, b: LineBox) =>
    Math.max(0, Math.min(natGap(a, b), connectTarget));
  let inkH = boxes[0].ascent + boxes[0].descent;
  for (let i = 1; i < boxes.length; i++) {
    inkH += gap(boxes[i - 1], boxes[i]) + boxes[i].ascent + boxes[i].descent;
  }
  const canvasH = Math.max(8, Math.ceil(inkH + margin * 2));
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${style}${fontPx}px ${input.fontFamily}`;
  // Draw each line so its measured ink box sits centred with `margin` padding.
  // The first character of line 1 is drawn at firstLetterScale; everything
  // is bottom-aligned on the same baseline so a drop cap extends upward.
  let cursorY = margin;
  // Per-character pens recorded when the box incl. auto-tightening was laid
  // out; draw each glyph at its tightened position (different spacing per
  // gap), with the drop cap at its enlarged size.
  const baselines: number[] = [];
  boxes.forEach((b, li) => {
    const baselineY = cursorY + b.ascent;
    baselines.push(baselineY);
    const inkLeft = (canvasW - (b.right - b.left)) / 2;
    const pen0 = inkLeft - b.left;
    for (let i = 0; i < b.seq.length; i++) {
      const { ch, px } = b.seq[i];
      if (ch === " " || ch === "\u00a0") continue;
      ctx.font = `${style}${px}px ${input.fontFamily}`;
      ctx.fillText(ch, pen0 + b.pens[i], baselineY);
    }
    cursorY = baselineY + b.descent + (li + 1 < boxes.length ? gap(boxes[li], boxes[li + 1]) : 0);
  });
  const data = ctx.getImageData(0, 0, canvasW, canvasH).data;
  const rawMask = new Uint8Array(canvasW * canvasH);
  for (let i = 0; i < rawMask.length; i++) rawMask[i] = data[i * 4] >= 128 ? 1 : 0;
  // Isolated ink of the enlarged first character, for the inner-text mask.
  const hasFirst = boxes.length > 0 && boxes[0].firstScale > 1.001 && boxes[0].first !== "";
  const compK0 = hasFirst ? boxes[0].compK : 0;
  let rawFirst: Uint8Array | null = null;
  if (hasFirst) {
    const fc = document.createElement("canvas");
    fc.width = canvasW;
    fc.height = canvasH;
    const fctx = fc.getContext("2d", { willReadFrequently: true })!;
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, canvasW, canvasH);
    fctx.fillStyle = "#fff";
    fctx.textBaseline = "alphabetic";
    const b0 = boxes[0];
    const inkLeft0 = (canvasW - (b0.right - b0.left)) / 2;
    const pen00 = inkLeft0 - b0.left;
    fctx.font = `${style}${fontPx * b0.firstScale}px ${input.fontFamily}`;
    fctx.fillText(b0.first, pen00 + (b0.pens[0] ?? 0), baselines[0]);
    const fd = fctx.getImageData(0, 0, canvasW, canvasH).data;
    rawFirst = new Uint8Array(canvasW * canvasH);
    for (let i = 0; i < rawFirst.length; i++) rawFirst[i] = fd[i * 4] >= 128 ? 1 : 0;
  }
  // Inner text first, then the border: erode ONLY the drop cap by compK
  // (computed from the same per-row intervals used for spacing, so what was
  // laid out is exactly what gets drawn). Every other letter is untouched.
  let mask = rawMask;
  let firstMask = rawFirst;
  if (hasFirst && rawFirst && compK0 > 0.5) {
    const distRaw = chamferToZero(rawMask, canvasW, canvasH);
    const comp = new Uint8Array(canvasW * canvasH);
    for (let i = 0; i < comp.length; i++) {
      if (rawMask[i] && !rawFirst[i]) comp[i] = 1;
      else if (rawFirst[i] && distRaw[i] - 1 > compK0) comp[i] = 1;
    }
    mask = comp;
    firstMask = new Uint8Array(canvasW * canvasH);
    for (let i = 0; i < firstMask.length; i++) firstMask[i] = rawFirst[i] && comp[i] ? 1 : 0;
  }
  // Safety net: if any ink still touches the raster edge (unmeasurable
  // overhang), re-render once with extra padding instead of clipping.
  let touches = false;
  for (let x = 0; x < canvasW && !touches; x++) {
    if (mask[x] || mask[(canvasH - 1) * canvasW + x]) touches = true;
  }
  for (let y = 0; y < canvasH && !touches; y++) {
    if (mask[y * canvasW] || mask[y * canvasW + canvasW - 1]) touches = true;
  }
  if (touches) {
    const pad = Math.ceil(4 * pxPerMm) + 4;
    const big = document.createElement("canvas");
    big.width = canvasW + pad * 2;
    big.height = canvasH + pad * 2;
    const bctx = big.getContext("2d", { willReadFrequently: true })!;
    bctx.fillStyle = "#000";
    bctx.fillRect(0, 0, big.width, big.height);
    bctx.drawImage(canvas, pad, pad);
    const bd = bctx.getImageData(0, 0, big.width, big.height).data;
    const bmask = new Uint8Array(big.width * big.height);
    for (let i = 0; i < bmask.length; i++) bmask[i] = bd[i * 4] >= 128 ? 1 : 0;
    let bigFirst: Uint8Array | null = null;
    if (firstMask) {
      bigFirst = new Uint8Array(big.width * big.height);
      for (let y = 0; y < canvasH; y++) {
        for (let x = 0; x < canvasW; x++) {
          bigFirst[(y + pad) * big.width + (x + pad)] = firstMask[y * canvasW + x];
        }
      }
    }
    return { mask: bmask, firstMask: bigFirst, gw: big.width, gh: big.height };
  }
  return { mask, firstMask, gw: canvasW, gh: canvasH };
}

/** Build the two-part sign: dilated outline + eroded raised inner text. */
export function buildTextSign(
  input: TextSignInput,
  bg: RGB,
  fg: RGB
): TextSignResult {
  const pxPerMm = 1 / input.pixelMm;
  const { mask: glyph, firstMask, gw, gh } = rasterizeText(input, pxPerMm);
  const warnings: string[] = [];
  const n = gw * gh;

  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = glyph[i] ? 0 : 1;

  // Outline = every pixel within outlineMm of a glyph pixel.
  const rOut = input.outlineMm * pxPerMm;
  const distToGlyph = chamferToZero(inv, gw, gh);
  const outline = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    outline[i] = glyph[i] || distToGlyph[i] <= rOut + 1e-6 ? 1 : 0;
  }

  // Guarantee: background must be ONE object. Spacing is fixed purely by
  // moving glyphs together (the auto-tightening above) — never by painting
  // connector bars between them. As a last resort, if components are still
  // separate (e.g. a detached "i" dot with no shared rows), report it.
  {
    const label = new Int32Array(n).fill(-1);
    let compCount = 0;
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!outline[i] || label[i] !== -1) continue;
      label[i] = compCount;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % gw;
        const cy = (c / gw) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const ni = ny * gw + nx;
            if (outline[ni] && label[ni] === -1) {
              label[ni] = compCount;
              stack.push(ni);
            }
          }
        }
      }
      compCount++;
    }
    if (compCount > 1) {
      warnings.push(
        "Some letters are still separate pieces — try a larger outline width."
      );
    }
  }

  // Inner = glyph pixels farther than insetMm from the glyph edge.
  // (chamferToZero measures glyph pixels' distance to background; a glyph
  // pixel's neighbour outside the glyph is at distance ~1, so subtract 1 to
  // get the true inward depth.)
  // The drop cap was already stroke-compensated in rasterizeText, so one
  // uniform erosion radius keeps the raised line weight equal everywhere.
  const rIn = input.insetMm * pxPerMm;
  const distToBg = chamferToZero(glyph, gw, gh);
  const inner = new Uint8Array(n);
  let innerCount = 0;
  for (let i = 0; i < n; i++) {
    if (glyph[i] && distToBg[i] - 1 > rIn) {
      inner[i] = 1;
      innerCount++;
    }
  }
  if (innerCount === 0) {
    warnings.push(
      "The raised inner section vanished: the letters are thinner than twice the inset. Lower the inset or use a bolder font."
    );
  }
  if (input.outlineMm < 0.8) {
    warnings.push(
      "Outline under 0.8 mm may print fragile on a 0.4 mm nozzle — consider at least 1.2 mm."
    );
  }

  const s = input.pixelMm;
  const zBase = input.baseHeightMm;
  const zTop = input.baseHeightMm + input.topHeightMm;

  let outCount = 0;
  for (let p = 0; p < n; p++) if (outline[p]) outCount++;

  const posOutline = buildSmoothExtrudedGeometry(outline, gw, gh, s, 0, zBase, [zBase]);
  const posInner = buildSmoothExtrudedGeometry(inner, gw, gh, s, zBase, zTop, [zBase]);

  const meshes: TextSignMesh[] = [
    {
      color: bg,
      name: `Outline (${rgbToHex(bg)})`,
      pixelCount: outCount,
      z0: 0,
      z1: zBase,
      positions: posOutline,
    },
    {
      color: fg,
      name: `Raised text (${rgbToHex(fg)})`,
      pixelCount: innerCount,
      z0: zBase,
      z1: zTop,
      positions: posInner,
    },
  ];
  const widthMm = gw * s;
  const heightMm = gh * s;
  return {
    meshes,
    gw,
    gh,
    pixelSizeMm: s,
    widthMm,
    heightMm,
    depthMm: zTop,
    triangleCount: (posOutline.length + posInner.length) / 9,
    bboxMm: { x: widthMm, y: heightMm, z: zTop },
    centerMm: { x: widthMm / 2, y: heightMm / 2 },
    outlineMask: outline,
    innerMask: inner,
    glyphMask: glyph,
    warnings,
  };
}

