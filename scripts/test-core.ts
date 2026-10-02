/**
 * Core-logic smoke test (run: npx tsx scripts/test-core.ts)
 * Builds synthetic images, runs all four print modes through the pipeline,
 * and validates geometry (manifoldness, z-bounds) plus STL/3MF output.
 */
import {
  autoPalette,
  collectPixels,
  mapPixelsToPalette,
  EMPTY,
  rgbToHex,
  nearestColorIndex,
  type RGB,
} from "../lib/quantize";
import { build3MF, buildSTL, buildSTLZip } from "../lib/exporters";
import {
  computeCmykStacks,
  meshPartPositions,
  processImageData,
} from "../lib/pipeline";
import {
  classifyPixels,
  makeShapeSilhouette,
  shapePolygon,
  SHAPE_CATEGORIES,
} from "../lib/shapes";
import { makeFineShapeGrid, buildShapeClippedGeometry } from "../lib/mesh";
import { applyCurve, curveRadius } from "../lib/curve";
import {
  formatSliderValue,
  parseSliderInput,
  resolveSliderCommit,
  stepDecimals,
} from "../lib/slider";
import {
  bboxFromCenter,
  groundSizeMeters,
  latToTileY,
  lngToTileX,
  tileRangeForBbox,
  tileXToLng,
  tileYToLat,
  zoomForTargetPixels,
} from "../lib/geo";
import { decodeTerrarium, resampleBilinear } from "../lib/terrainTiles";
import {
  buildTerrainFromHeights,
  normFromElevations,
} from "../lib/terrain";
import { buildBadgeFromMasks } from "../lib/badge";
import { chamferToZero } from "../lib/textSign";
import { clearCircle, fitHole, runCentre } from "../lib/masks";
import { buildCoasterFromGrid, RELIEF_LEVELS } from "../lib/coaster";
import {
  buildBuildingParts,
  buildingHeight,
  type BuildingContext,
  type BuildingFootprint,
} from "../lib/buildings";
import JSZip from "jszip";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ok  - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

/**
 * Classified edge analysis. Returns:
 *  - holes: boundary edges (shared by 1 triangle) — a real hole in the mesh
 *  - bad: edges shared by 0, 3, 5+ triangles — genuinely broken topology
 *  - saddles: 4-way edges — two diagonal heightfield cells touching along a
 *    point-contact edge; a zero-volume artifact that slicers auto-repair and
 *    that the per-pixel builder always produced. Count (not orientation) is
 *    used so plate bending (curvature) doesn't turn them into "bad" edges.
 */
function analyzeEdges(positions: number[]): {
  holes: number;
  bad: number;
  saddles: number;
} {
  const vkey = (i: number) =>
    positions[i].toFixed(3) +
    "," +
    positions[i + 1].toFixed(3) +
    "," +
    positions[i + 2].toFixed(3);
  const edges = new Map<string, number>();
  for (let t = 0; t + 8 < positions.length; t += 9) {
    for (let e = 0; e < 3; e++) {
      const a = vkey(t + [0, 3, 6][e]);
      const b = vkey(t + [0, 3, 6][(e + 1) % 3]);
      const k = a < b ? a + "|" + b : b + "|" + a;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let holes = 0, bad = 0, saddles = 0;
  for (const c of edges.values()) {
    if (c === 2) continue;
    if (c === 1) holes++;
    else if (c === 4) saddles++;
    else bad++;
  }
  return { holes, bad, saddles };
}

/** Count edges shared by other than exactly 2 triangles (non-manifold). */
function countNonManifoldEdges(positions: number[]): number {
  const vkey = (i: number) =>
    positions[i].toFixed(3) +
    "," +
    positions[i + 1].toFixed(3) +
    "," +
    positions[i + 2].toFixed(3);
  const edges = new Map<string, number>();
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const v0 = vkey(t),
      v1 = vkey(t + 3),
      v2 = vkey(t + 6);
    const pairs = [
      [v0, v1],
      [v1, v2],
      [v2, v0],
    ];
    for (const [a, b] of pairs) {
      const k = a < b ? a + "|" + b : b + "|" + a;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const c of edges.values()) if (c !== 2) bad++;
  return bad;
}

// --- Synthetic 8x8 RGBA image: 4 quadrant colors + transparent corner
const W = 8,
  H = 8;
const RED: RGB = [220, 30, 30];
const GREEN: RGB = [30, 200, 60];
const BLUE: RGB = [40, 60, 220];
const WHITE: RGB = [240, 240, 235];
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const c = x < 4 ? (y < 4 ? RED : BLUE) : y < 4 ? GREEN : WHITE;
    data[o] = Math.min(255, Math.max(0, c[0] + ((x * 7 + y * 13) % 9) - 4));
    data[o + 1] = Math.min(255, Math.max(0, c[1] + ((x * 5 + y * 11) % 9) - 4));
    data[o + 2] = Math.min(255, Math.max(0, c[2] + ((x * 3 + y * 17) % 9) - 4));
    data[o + 3] = 255;
  }
}
data[3] = 0; // transparent pixel at (0,0)
const quadImage = { data, width: W, height: H } as unknown as ImageData;

console.log("quantization:");
const palette = autoPalette(collectPixels(data), 4);
check(palette.length === 4, `autoPalette returns 4 colors (got ${palette.length})`);
console.log("  palette:", palette.map(rgbToHex).join(", "));

const targets = [RED, GREEN, BLUE, WHITE];
for (const t of targets) {
  const i = nearestColorIndex(t[0], t[1], t[2], palette);
  const p = palette[i];
  const dist = Math.abs(t[0] - p[0]) + Math.abs(t[1] - p[1]) + Math.abs(t[2] - p[2]);
  check(dist < 40, `palette has a close match for rgb(${t.join(",")}) (dist=${dist})`);
}

const grid = mapPixelsToPalette(data, palette);
check(grid.length === W * H, "grid has one entry per pixel");
check(grid[0] === EMPTY, "transparent pixel maps to EMPTY");

console.log("variable palette quantization (2, 5, 8 colors, and empty buffer):");
for (const k of [2, 5, 8]) {
  const pK = autoPalette(collectPixels(data), k);
  check(pK.length === k, `autoPalette returns ${k} colors for k=${k} (got ${pK.length})`);
  const mosaicK = processImageData(quadImage, pK, 40, 5, "mosaic");
  check(mosaicK.meshes.length === k, `mosaic ${k}-color: ${k} parts`);
  for (const m of mosaicK.meshes) {
    const bad = countNonManifoldEdges(m.positions);
    check(bad === 0, `mosaic ${k}-color ${m.name}: manifold (${bad} bad edges)`);
  }
}
const emptyPal2 = autoPalette([], 2);
check(emptyPal2.length === 2, `autoPalette fallback on empty pixels produces 2 colors (got ${emptyPal2.length})`);
const emptyPal8 = autoPalette([], 8);
check(emptyPal8.length === 8, `autoPalette fallback on empty pixels produces 8 colors (got ${emptyPal8.length})`);

console.log("mosaic mode:");
const mosaic = processImageData(quadImage, palette, 40, 5, "mosaic");
check(mosaic.meshes.length === 4, "mosaic: 4 parts");
check(
  mosaic.meshes.map((m) => m.pixelCount).join(",") === "16,15,16,16",
  `mosaic per-color coverage 16,15,16,16 (got ${mosaic.meshes.map((m) => m.pixelCount).join(",")})`
);
for (const m of mosaic.meshes) {
  check(m.positions.length > 0 && m.positions.length % 9 === 0, `${m.name}: positions valid`);
  const bad = countNonManifoldEdges(m.positions);
  check(bad === 0, `${m.name}: manifold (${bad} bad edges)`);
  const zs = m.positions.filter((_, i) => i % 3 === 2);
  check(
    zs.every((z) => Math.abs(z) < 1e-6 || Math.abs(z - 5) < 1e-6),
    `${m.name}: all z at 0 or 5`
  );
}

console.log("layered (HueForge-style) mode:");
const layered = processImageData(quadImage, palette, 40, 5, "layered", 0.2);
const expectedTops = [1.2, 2.6, 3.8, 5.0];
check(
  layered.bands.every((b, i) => Math.abs(b.z1 - expectedTops[i]) < 1e-6),
  `band tops snap to layers [${layered.bands.map((b) => b.z1.toFixed(2)).join(", ")}]`
);
check(Math.abs(layered.depthMm - 5) < 1e-6, "effective depth = 5 mm");
check(
  layered.meshes.map((m) => m.pixelCount).join(",") === "63,47,32,16",
  `band coverage nests 63,47,32,16 (got ${layered.meshes.map((m) => m.pixelCount).join(",")})`
);
for (let i = 0; i < 4; i++) {
  const m = layered.meshes[i];
  const bad = countNonManifoldEdges(m.positions);
  check(bad === 0, `layered band ${i}: manifold (${bad} bad edges)`);
  const zs = m.positions.filter((_, i2) => i2 % 3 === 2);
  check(
    zs.every((z) => z >= m.z0 - 1e-6 && z <= m.z1 + 1e-6),
    `layered band ${i}: z within [${m.z0.toFixed(1)}, ${m.z1.toFixed(1)}]`
  );
}

console.log("lithophane mode:");
const GW = 16,
  GH = 16;
const gdata = new Uint8ClampedArray(GW * GH * 4);
for (let y = 0; y < GH; y++) {
  for (let x = 0; x < GW; x++) {
    const o = (y * GW + x) * 4;
    const g = x * 17; // horizontal gray gradient 0..255
    gdata[o] = g;
    gdata[o + 1] = g;
    gdata[o + 2] = g;
    gdata[o + 3] = 255;
  }
}
gdata[3] = 0; // transparent at (0,0)
const gImage = { data: gdata, width: GW, height: GH } as unknown as ImageData;
const litho = processImageData(gImage, [], 80, 4, "lithophane", 0.2, 0.8);

check(litho.meshes.length === 1, "lithophane produces a single part");
const lhGrid = litho.heights!;
check(lhGrid[0] === 0, "transparent pixel has no geometry");
check(
  Array.from(lhGrid).every(
    (h) => h === 0 || Math.abs(h / 0.2 - Math.round(h / 0.2)) < 1e-4
  ),
  "all heights snap to whole print layers"
);
const hAt = (x: number, y: number) => lhGrid[y * GW + x];
let monotone = true;
for (let x = 1; x < GW; x++) {
  if (hAt(x, 5) > hAt(x - 1, 5) + 1e-6) monotone = false;
}
check(monotone, "brighter pixels are never thicker (monotone gradient)");
check(
  Math.abs(hAt(0, 5) - 4) < 1e-4 && Math.abs(hAt(15, 5) - 0.8) < 1e-4,
  `black -> max 4.0mm, white -> min 0.8mm (got ${hAt(0, 5).toFixed(2)}, ${hAt(15, 5).toFixed(2)})`
);
{
  const lp = litho.meshes[0].positions;
  check(lp.length > 0 && lp.length % 9 === 0, "lithophane positions valid");
  const bad = countNonManifoldEdges(lp);
  check(bad === 0, `lithophane manifold (${bad} bad edges)`);
  const zs = lp.filter((_, i) => i % 3 === 2);
  check(
    zs.every((z) => z >= -1e-6 && z <= 4 + 1e-4),
    "lithophane z within [0, 4]"
  );
}

console.log("CMYK lithophane mode:");
const cmykData = new Uint8ClampedArray(5 * 1 * 4);
const setPx = (i: number, r: number, g: number, b: number, a = 255) => {
  cmykData[i * 4] = r;
  cmykData[i * 4 + 1] = g;
  cmykData[i * 4 + 2] = b;
  cmykData[i * 4 + 3] = a;
};
setPx(0, 255, 255, 255); // white
setPx(1, 0, 0, 0); // black
setPx(2, 255, 0, 0); // red
setPx(3, 128, 128, 128); // gray
setPx(4, 200, 40, 200, 0); // transparent
const cmykImage = { data: cmykData, width: 5, height: 1 } as unknown as ImageData;
const cmykOpts = { colorLayers: 4, whiteMinLayers: 2, whiteMaxLayers: 10 };
const stacks = computeCmykStacks(cmykImage, cmykOpts);

check(
  stacks.c[0] === 0 && stacks.m[0] === 0 && stacks.y[0] === 0 && stacks.w[0] === 2,
  "white pixel: no color layers, min white"
);
check(
  stacks.c[1] === 4 && stacks.m[1] === 4 && stacks.y[1] === 4 && stacks.w[1] === 10,
  "black pixel: max color layers, max white"
);
check(
  stacks.c[2] === 0 && stacks.m[2] === 4 && stacks.y[2] === 4,
  "red pixel: magenta + yellow only"
);
check(
  stacks.w[4] === 0 && stacks.c[4] + stacks.m[4] + stacks.y[4] === 0,
  "transparent pixel: no geometry"
);

const cmykProc = processImageData(cmykImage, [], 50, 5, "cmyk", 0.2, 0.8, cmykOpts);
check(cmykProc.meshes.length === 4, "CMYK produces 4 parts");
check(
  /Cyan/.test(cmykProc.meshes[0].name) && /White/.test(cmykProc.meshes[3].name),
  "part order is C, M, Y, White"
);
check(
  Math.abs(cmykProc.depthMm - 4.4) < 1e-4,
  `max height = 4.4 mm (got ${cmykProc.depthMm.toFixed(2)})`
);
check(
  cmykProc.meshes[0].pixelCount === 2,
  `cyan part covers black+gray = 2 pixels (got ${cmykProc.meshes[0].pixelCount})`
);
check(
  cmykProc.meshes[3].pixelCount === 4,
  `white part covers all 4 opaque pixels (got ${cmykProc.meshes[3].pixelCount})`
);
for (const m of cmykProc.meshes) {
  const bad = countNonManifoldEdges(m.positions);
  check(bad === 0, `${m.name}: manifold (${bad} bad edges)`);
}
const prev = cmykProc.cmykPreview!;
check(
  prev[0] > prev[4],
  `backlit preview: white pixel brighter than black (${prev[0]} vs ${prev[4]})`
);

console.log("smoothed surface mode:");
function signedVolume(positions: number[]): number {
  let v = 0;
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const ax = positions[t],
      ay = positions[t + 1],
      az = positions[t + 2];
    const bx = positions[t + 3],
      by = positions[t + 4],
      bz = positions[t + 5];
    const cx = positions[t + 6],
      cy = positions[t + 7],
      cz = positions[t + 8];
    v +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return v;
}

const lithoSmooth = processImageData(
  gImage,
  [],
  80,
  4,
  "lithophane",
  0.2,
  0.8,
  undefined,
  true
);
{
  const lp = lithoSmooth.meshes[0].positions;
  check(lp.length > 0 && lp.length % 9 === 0, "smooth lithophane positions valid");
  const bad = countNonManifoldEdges(lp);
  check(bad === 0, `smooth lithophane manifold (${bad} bad edges)`);
  const zs = lp.filter((_, i) => i % 3 === 2);
  check(
    zs.every((z) => z >= -1e-6 && z <= 4 + 1e-4),
    "smooth lithophane z within [0, 4]"
  );
  // interpolated surface volume should be close to the stepped column volume
  let columnVol = 0;
  for (let i = 0; i < lhGrid.length; i++) columnVol += lhGrid[i] * 25;
  const v = signedVolume(lp);
  check(
    Math.abs(v - columnVol) < 0.12 * columnVol,
    `smooth lithophane volume sane (${v.toFixed(0)} vs stepped ${columnVol.toFixed(0)})`
  );
}

const cmykSmooth = processImageData(
  cmykImage,
  [],
  50,
  5,
  "cmyk",
  0.2,
  0.8,
  cmykOpts,
  true
);
check(
  cmykSmooth.meshes.length === 4,
  "smooth CMYK produces 4 parts"
);
for (const m of cmykSmooth.meshes) {
  const bad = countNonManifoldEdges(m.positions);
  check(bad === 0, `smooth CMYK ${m.name}: manifold (${bad} bad edges)`);
}

console.log("shapes:");
// circle, size 100%, centered, 1px border on an 8x8 grid
const cls = classifyPixels(
  8,
  8,
  { type: "circle", cx: 0.5, cy: 0.5, size: 1 },
  1
);
check(cls !== null, "circle shape produces a classification");
check(cls![4 * 8 + 4] === 2, "circle: center pixel is inside");
check(cls![4] === 1, "circle: boundary pixel is border");
check(cls![7 * 8 + 7] === 0, "circle: corner pixel is outside");
{
  let n0 = 0,
    n1 = 0,
    n2 = 0;
  for (const c of cls!) {
    if (c === 0) n0++;
    else if (c === 1) n1++;
    else n2++;
  }
  check(n0 + n1 + n2 === 64, "classification covers all pixels");
  check(n1 > 0, `border ring exists (${n1} px)`);
  check(n2 > n1 && n2 > n0, `inside dominates (${n2} in, ${n0} out)`);
}

// shape sanity: centers inside (crescent moon's center is carved out, so
// check a point on its left limb instead), corners outside
for (const t of [
  "triangle",
  "hexagon",
  "heart",
  "star",
  "diamond",
  "cross",
  "tree",
  "snowflake",
  "stocking",
  "bell",
  "gingerbread-man",
  "gingerbread-woman",
  "pumpkin",
  "ghost",
  "bat",
  "leaf",
  "acorn",
  "egg",
  "bunny",
  "flower",
  "tulip",
  "butterfly",
  "shamrock",
  "sun",
  "shell",
  "starfish",
] as const) {
  const c = classifyPixels(16, 16, { type: t, cx: 0.5, cy: 0.5, size: 1 }, 0)!;
  check(c[8 * 16 + 8] === 2, `${t}: center inside`);
  check(c[0] === 0, `${t}: corner outside`);
}
{
  // crescent moon: the middle is carved out, so the left limb is solid
  const c = classifyPixels(
    16,
    16,
    { type: "moon", cx: 0.5, cy: 0.5, size: 1 },
    0
  )!;
  check(c[8 * 16 + 2] === 2, "moon: left limb inside");
  check(c[8 * 16 + 8] === 0, "moon: center carved out");
  check(c[0] === 0, "moon: corner outside");
}
{
  // square on a wide grid: far side is outside the shape
  const c = classifyPixels(32, 16, { type: "square", cx: 0.5, cy: 0.5, size: 1 }, 0)!;
  check(c[8 * 32 + 8] === 2, "square: center inside");
  check(c[8 * 32 + 0] === 0, "square: far side outside");
}
{
  // star: the concave notch between two points is outside the shape
  // (needs a fine grid so rounding does not slip back inside)
  const S = 128;
  const star = classifyPixels(S, S, { type: "star", cx: 0.5, cy: 0.5, size: 1 }, 0)!;
  const a = (Math.PI / 2) + (Math.PI / 5); // angle of first inner vertex
  const r = 0.42 * 1.25; // just past the inner vertex radius
  const px = Math.round(S / 2 + r * Math.cos(a) * (S / 2));
  const py = Math.round(S / 2 - r * Math.sin(a) * (S / 2));
  check(star[py * S + px] === 0, "star: inner notch is outside");
}

// outline sanity for every picker shape: the polygon must be simple (no
// crossing or doubled-back edges) and must never enclose background pixels.
// An arc sampled the wrong way round loops back through the shape's interior,
// which the even-odd fill then carves out as a hole — the bug that produced
// cut-outs in the gingerbread head, pumpkin stem, bell knob, ghost sides,
// acorn cap, shamrock stem and moon horns. Regression test for those.
{
  /** Segments sharing an interior point: a proper crossing, or a collinear
   *  overlap longer than EPS (the doubled-back-edge case). */
  const segsMeet = (
    a: [number, number],
    b: [number, number],
    c: [number, number],
    d: [number, number]
  ): boolean => {
    const d1x = b[0] - a[0];
    const d1y = b[1] - a[1];
    const d2x = d[0] - c[0];
    const d2y = d[1] - c[1];
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) > 1e-12) {
      const t = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / denom;
      const u = ((c[0] - a[0]) * d1y - (c[1] - a[1]) * d1x) / denom;
      return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
    }
    const len1 = Math.hypot(d1x, d1y);
    if (len1 < 1e-9) return false;
    if (Math.abs((c[0] - a[0]) * d1y - (c[1] - a[1]) * d1x) / len1 > 1e-9) {
      return false; // parallel but not collinear
    }
    const ux = d1x / len1;
    const uy = d1y / len1;
    const proj = (p: [number, number]) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    const lo = Math.max(0, Math.min(proj(c), proj(d)));
    const hi = Math.min(len1, Math.max(proj(c), proj(d)));
    return hi - lo > 1e-9;
  };

  const types = new Set<string>();
  for (const cat of SHAPE_CATEGORIES) {
    for (const s of cat.shapes) types.add(s.type);
  }
  const crossing: string[] = [];
  const holed: string[] = [];
  for (const t of types) {
    const poly = shapePolygon(t as Parameters<typeof shapePolygon>[0]);
    if (!poly) continue;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // skip edges that share a vertex
        if ((j + 1) % n === i || (i + 1) % n === j) continue;
        if (segsMeet(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) {
          crossing.push(`${t} e${i}xe${j}`);
        }
      }
    }
    // Rasterize at 0.82 size so the shape sits inside a background ring, then
    // flood-fill the background from the frame (8-connected, so diagonal
    // pinches don't count) — anything unreachable is an enclosed hole.
    const S = 128;
    const cls = classifyPixels(
      S,
      S,
      { type: t as Parameters<typeof shapePolygon>[0], cx: 0.5, cy: 0.5, size: 0.82 },
      0
    )!;
    const seen = new Uint8Array(S * S);
    const stack: number[] = [];
    const push = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= S || y >= S) return;
      const k = y * S + x;
      if (seen[k] || cls[k] !== 0) return;
      seen[k] = 1;
      stack.push(k);
    };
    for (let x = 0; x < S; x++) {
      push(x, 0);
      push(x, S - 1);
    }
    for (let y = 0; y < S; y++) {
      push(0, y);
      push(S - 1, y);
    }
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % S;
      const y = (k / S) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) push(x + dx, y + dy);
      }
    }
    let trapped = 0;
    for (let k = 0; k < S * S; k++) {
      if (cls[k] === 0 && !seen[k]) trapped++;
    }
    if (trapped > 0) holed.push(`${t} (${trapped}px)`);
  }
  check(
    crossing.length === 0,
    `shape outlines never self-cross (${types.size} shapes` +
      (crossing.length ? `, bad: ${crossing.join(", ")}` : "") +
      ")"
  );
  check(
    holed.length === 0,
    `shape outlines carve no holes (${types.size} shapes` +
      (holed.length ? `, bad: ${holed.join(", ")}` : "") +
      ")"
  );
}

// pipeline integration: circle mask + border on the quadrant mosaic
const shapedMosaic = processImageData(
  quadImage,
  palette,
  40,
  5,
  "mosaic",
  0.2,
  0.8,
  undefined,
  false,
  { shape: { type: "circle", cx: 0.5, cy: 0.5, size: 1 }, borderMm: 5 }
);
check(
  shapedMosaic.filledPixels < 63,
  `circle mask removes pixels (${shapedMosaic.filledPixels}/63 filled)`
);
{
  // every non-empty pixel is inside or border; border pixels are Filament 1
  let borderPxCount = 0;
  for (let i = 0; i < shapedMosaic.grid.length; i++) {
    if (shapedMosaic.grid[i] !== EMPTY && cls![i] === 1) borderPxCount++;
  }
  check(borderPxCount > 0, "mosaic: border pixels assigned to Filament 1");
  for (const m of shapedMosaic.meshes) {
    const bad = countNonManifoldEdges(m.positions);
    check(bad === 0, `shaped mosaic ${m.name}: manifold (${bad} bad edges)`);
  }
}

// lithophane with heart mask: outside pixels are empty, manifold
const shapedLitho = processImageData(
  gImage,
  [],
  80,
  4,
  "lithophane",
  0.2,
  0.8,
  undefined,
  false,
  { shape: { type: "heart", cx: 0.5, cy: 0.5, size: 1 } }
);
check(
  shapedLitho.filledPixels < 256,
  `heart mask removes lithophane pixels (${shapedLitho.filledPixels}/256 filled)`
);
{
  const bad = countNonManifoldEdges(shapedLitho.meshes[0].positions);
  check(bad === 0, `heart lithophane manifold (${bad} bad edges)`);
}

// smooth silhouette: shape edges follow the true geometry, not a pixel
// staircase
{
  // circle mosaic: no mesh vertex may protrude outside the true circle, and
  // a good number of vertices must sit exactly on it (blocky approximations
  // put vertices up to ~0.5px outside and only corners near the boundary)
  const shaped = processImageData(
    quadImage,
    palette,
    40,
    5,
    "mosaic",
    0.2,
    0.8,
    undefined,
    false,
    { shape: { type: "circle", cx: 0.5, cy: 0.5, size: 1 } }
  );
  const ps = 40 / 8; // pixel size, mm
  const rmm = 4 * ps; // circle radius in mm
  let maxOut = 0;
  let onCircle = 0;
  const seen = new Set<string>();
  for (const m of shaped.meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      const X = m.positions[i];
      const Y = m.positions[i + 1];
      const k = X.toFixed(4) + "," + Y.toFixed(4);
      if (seen.has(k)) continue;
      seen.add(k);
      const d = Math.hypot(X - 4 * ps, 8 * ps - Y - 4 * ps);
      maxOut = Math.max(maxOut, d - rmm);
      if (Math.abs(d - rmm) < 0.05 * ps) onCircle++;
    }
  }
  check(
    maxOut <= 0.2 * ps,
    `circle silhouette never protrudes the true circle (max ${maxOut.toFixed(3)}mm, tol ${(0.2 * ps).toFixed(2)}mm)`
  );
  check(onCircle >= 16, `circle silhouette follows the curve (${onCircle} vertices on the boundary)`);
}

// sharp and concave shapes stay manifold through the pipeline
for (const t of ["triangle", "hexagon", "star", "heart"] as const) {
  const proc = processImageData(
    quadImage,
    palette,
    40,
    5,
    "mosaic",
    0.2,
    0.8,
    undefined,
    false,
    { shape: { type: t, cx: 0.5, cy: 0.5, size: 1 } }
  );
  for (const m of proc.meshes) {
    const bad = countNonManifoldEdges(m.positions);
    check(bad === 0, `${t} mosaic ${m.name}: manifold (${bad} bad edges)`);
  }
  // lithophane (smooth relief path) too
  const litho = processImageData(
    gImage,
    [],
    80,
    4,
    "lithophane",
    0.2,
    0.8,
    undefined,
    true,
    { shape: { type: t, cx: 0.5, cy: 0.5, size: 1 } }
  );
  const bad = countNonManifoldEdges(litho.meshes[0].positions);
  check(bad === 0, `${t} smooth lithophane: manifold (${bad} bad edges)`);
}

// adversarial geometry sweep: random noise images, random shapes/positions,
// all print modes and both relief modes. Every part of every plate must stay
// manifold (no boundary/over-connected edges) — this is what catches pinches,
// z-saddle corners and degenerate fine cells at shape edges.
console.log("randomised plate sweep:");
{
  let rng = 987654321;
  const rnd = () =>
    (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const shapeTypes = [
    "circle",
    "triangle",
    "hexagon",
    "star",
    "heart",
    "square",
    "diamond",
    "cross",
    "tree",
    "snowflake",
    "stocking",
    "bell",
    "gingerbread-man",
    "gingerbread-woman",
    "pumpkin",
    "ghost",
    "bat",
    "leaf",
    "acorn",
    "egg",
    "bunny",
    "flower",
    "tulip",
    "butterfly",
    "shamrock",
    "sun",
    "shell",
    "starfish",
    "moon",
  ] as const;
  const modes = ["mosaic", "layered", "lithophane", "cmyk"] as const;
  const sweepPalette: RGB[] = [
    [30, 30, 30],
    [200, 40, 40],
    [40, 200, 60],
    [240, 240, 235],
  ];
  let configs = 0;
  let badMeshes = 0;
  for (let iter = 0; iter < 24; iter++) {
    const W = 8 + Math.floor(rnd() * 32);
    const H = 8 + Math.floor(rnd() * 32);
    const pixels = new Uint8ClampedArray(W * H * 4);
    const transparency = rnd();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        pixels[o] = rnd() * 255;
        pixels[o + 1] = rnd() * 255;
        pixels[o + 2] = rnd() * 255;
        // mix opaque, checkerboard cut-outs and scattered transparent pixels
        pixels[o + 3] =
          transparency < 0.2
            ? (x + y) % 2
              ? 255
              : 0
            : transparency < 0.4
              ? rnd() < 0.15
                ? 0
                : 255
              : 255;
      }
    }
    const image = { data: pixels, width: W, height: H } as unknown as ImageData;
    const type = shapeTypes[Math.floor(rnd() * shapeTypes.length)];
    const mode = modes[Math.floor(rnd() * modes.length)];
    const smooth = rnd() < 0.5;
    const curve = rnd() < 0.25 ? rnd() * 180 : 0;
    const border = rnd() < 0.4 ? rnd() * 3 : 0;
    configs++;
    const proc = processImageData(
      image,
      sweepPalette,
      100,
      5,
      mode,
      0.2,
      0.8,
      { colorLayers: 4, whiteMinLayers: 2, whiteMaxLayers: 10 },
      smooth,
      {
        shape: {
          type,
          cx: 0.15 + rnd() * 0.7,
          cy: 0.15 + rnd() * 0.7,
          size: 0.3 + rnd() * 1.1,
        },
        borderMm: border,
      },
      curve
    );
    for (const m of proc.meshes) {
      // Real defects = holes (boundary edges) or genuinely broken topology.
      // Vertical 4-way "saddle" edges (two diagonal cells touching at a point)
      // are tolerated: zero-volume, slicer-auto-repaired, and always present
      // in the per-pixel builder.
      const { holes, bad, saddles } = analyzeEdges(m.positions);
      if (holes > 0 || bad > 0) {
        badMeshes++;
        if (badMeshes <= 3) {
          console.error(
            `  FAIL - sweep ${iter} (${type} ${mode} smooth=${smooth} curve=${curve.toFixed(0)} border=${border.toFixed(1)} ${W}x${H}) ${m.name}: holes=${holes} bad=${bad} saddles=${saddles}`
          );
        }
      }
      if (!m.positions.every(Number.isFinite)) {
        badMeshes++;
        console.error(`  FAIL - sweep ${iter} ${m.name}: non-finite coordinates`);
      }
    }
  }
  check(badMeshes === 0, `${configs} randomised plates are manifold (${badMeshes} bad meshes)`);
}

// Run-merge T-junctions: merged top/bottom face runs must never skip a fine
// vertex that a wall uses. A grid-aligned silhouette (no snapped corners to
// force column breaks) with per-pixel z variation used to merge runs across
// fine cells whose z-step / silhouette walls are emitted per fine cell,
// leaving T-junction boundary edges — slicers report those as non-manifold
// and Bambu Studio shows a repair prompt, for every shape except "full"
// (which never uses the merged builder). Regression for that report.
console.log("run-merge T-junction regression (grid-aligned shape):");
{
  const mk = (z1: (x: number, y: number) => number): number[] => {
    const gw = 4,
      gh = 2,
      ps = 10;
    const z0s = new Float32Array(gw * gh);
    const z1s = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) z1s[y * gw + x] = z1(x, y);
    }
    const fine = makeFineShapeGrid(
      makeShapeSilhouette({ type: "square", cx: 0.5, cy: 0.5, size: 1 }, gw, gh),
      gw,
      gh,
      4
    );
    return buildShapeClippedGeometry(z0s, z1s, gw, gh, ps, fine, false, null, null);
  };
  for (const [label, geom] of [
    ["uniform z", mk(() => 5)],
    ["z-step bands", mk((_x, y) => (y === 0 ? 5 : 3))],
  ] as [string, number[]][]) {
    const { holes, bad } = analyzeEdges(geom);
    check(
      holes === 0 && bad === 0,
      `shape-clipped ${label}: runs keep every wall vertex (holes=${holes} bad=${bad})`
    );
  }

  // Pipeline level: a perfectly grid-aligned square on a noisy image used to
  // leave hundreds to thousands of T-junction edges in every mode but mosaic.
  {
    const GW2 = 24,
      GH2 = 18;
    let rng = 24680;
    const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const px = new Uint8ClampedArray(GW2 * GH2 * 4);
    for (let i = 0; i < GW2 * GH2; i++) {
      const o = i * 4;
      px[o] = rnd() * 255;
      px[o + 1] = rnd() * 255;
      px[o + 2] = rnd() * 255;
      px[o + 3] = 255;
    }
    const img = { data: px, width: GW2, height: GH2 } as unknown as ImageData;
    const pal: RGB[] = autoPalette(collectPixels(px), 4);
    for (const mode of ["mosaic", "layered", "lithophane", "cmyk"] as const) {
      const proc = processImageData(
        img,
        pal,
        100,
        5,
        mode,
        0.2,
        0.8,
        { colorLayers: 4, whiteMinLayers: 2, whiteMaxLayers: 10 },
        false,
        { shape: { type: "square", cx: 0.5, cy: 0.5, size: 1 }, borderMm: 0 }
      );
      let holes = 0,
        bad = 0;
      for (const m of proc.meshes) {
        const r = analyzeEdges(m.positions);
        holes += r.holes;
        bad += r.bad;
      }
      check(
        holes === 0 && bad === 0,
        `grid-aligned square ${mode}: runs keep every wall vertex (holes=${holes} bad=${bad})`
      );
    }
  }
}

// 1-pixel checkerboard dithering (most 8/16-bit game art) is the worst case
// for per-colour diagonal contacts: two same-colour cells touching only at a
// corner leave a four-way point-contact edge, which Bambu Studio refuses
// instead of repairing. The pinch fill must run to convergence — with a fixed
// two passes thousands of contacts survive on real dithered art (measured on
// a 512 px 4-colour mosaic).
console.log("checkerboard dither pinch regression:");
{
  // A PERTURBED checkerboard: real dithered art is never a clean alternation
  // (quantisation and region junctions break it), and those defects are what
  // stop the pinch fill from cascading — measured 73 point-contact edges per
  // 32x32 plate (146 across its parts) and 1036 at 64x64 with the old
  // two-pass fill.
  const Wc = 32,
    Hc = 32;
  const cpx = new Uint8ClampedArray(Wc * Hc * 4);
  for (let y = 0; y < Hc; y++) {
    for (let x = 0; x < Wc; x++) {
      const o = (y * Wc + x) * 4;
      const even =
        (((x + y) % 2) ^
          ((Math.imul(x * 31 + y * 17, 2654435761) >>> 28) & 1)) === 0;
      cpx[o] = cpx[o + 1] = cpx[o + 2] = even ? 250 : 10;
      cpx[o + 3] = 255;
    }
  }
  const cimg = { data: cpx, width: Wc, height: Hc } as unknown as ImageData;
  const cpal: RGB[] = [
    [10, 10, 10],
    [250, 250, 250],
    [120, 40, 40],
    [40, 90, 160],
  ];
  const proc = processImageData(
    cimg,
    cpal,
    60,
    5,
    "mosaic",
    0.2,
    0.8,
    undefined,
    false,
    { shape: { type: "square", cx: 0.5, cy: 0.5, size: 0.8 }, borderMm: 0 }
  );
  let worst = 0;
  for (const m of proc.meshes) {
    const { holes, bad, saddles } = analyzeEdges(m.positions);
    worst = Math.max(worst, holes + bad + saddles);
  }
  check(
    worst === 0,
    `1-px checkerboard mosaic has no point-contact edges (worst=${worst})`
  );
}

// Edge-band dither absorption: the outer wall shows one colour column per
// boundary pixel, so a dithered outline turns the wall into a barcode of
// sub-millimetre colour columns that no slicer can print faithfully (it reads
// as a shattered edge). Runs shorter than a printable length must be absorbed
// into their neighbour, while interior pixels keep their exact colours.
console.log("edge-band dither absorption:");
{
  const S = 32;
  const epx = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      const even =
        ((((x + y) % 2) ^
          ((Math.imul(x * 31 + y * 17, 2654435761) >>> 28) & 1)) === 0);
      epx[o] = epx[o + 1] = epx[o + 2] = even ? 250 : 10;
      epx[o + 3] = 255;
    }
  }
  const eimg = { data: epx, width: S, height: S } as unknown as ImageData;
  const epal: RGB[] = [
    [10, 10, 10],
    [250, 250, 250],
    [120, 40, 40],
    [40, 90, 160],
  ];
  const proc = processImageData(
    eimg,
    epal,
    60,
    5,
    "mosaic",
    0.2,
    0.8,
    undefined,
    false,
    { shape: { type: "square", cx: 0.5, cy: 0.5, size: 0.8 }, borderMm: 0 }
  );
  const g = proc.grid;
  const minRun = Math.max(2, Math.round(1.4 / proc.pixelSizeMm));
  let mL = -1,
    mR = -1,
    mT = -1,
    mB = -1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (g[y * S + x] === EMPTY) continue;
      if (mL < 0 || x < mL) mL = x;
      if (x > mR) mR = x;
      if (mT < 0 || y < mT) mT = y;
      if (y > mB) mB = y;
    }
  }
  const wallRuns = (get: (k: number) => number, from: number, to: number): number[] => {
    const lens: number[] = [];
    let last = -1,
      cur = 0;
    for (let k = from; k <= to; k++) {
      const c = get(k);
      if (c === EMPTY) continue;
      if (c === last) cur++;
      else {
        if (cur) lens.push(cur);
        last = c;
        cur = 1;
      }
    }
    if (cur) lens.push(cur);
    return lens;
  };
  const edges = [
    wallRuns((k) => g[k * S + mL], mT, mB),
    wallRuns((k) => g[k * S + mR], mT, mB),
    wallRuns((k) => g[mT * S + k], mL, mR),
    wallRuns((k) => g[mB * S + k], mL, mR),
  ];
  const shortRuns = edges.flat().filter((l) => l < minRun).length;
  const totalRuns = edges.reduce((a, e) => a + e.length, 0);
  check(
    shortRuns === 0,
    `wall has no unprintably short colour runs (${shortRuns} runs < ${minRun}px, was 28)`
  );
  check(
    totalRuns <= 26,
    `dithered outline collapses into few wall colour runs (${totalRuns}, was 54)`
  );
}

// Border ring: the ring must be classified per fine cell against the true
// shape distance — reaching exactly out to the smooth silhouette (no ragged
// interior band short of the edge, the reported "outside edge gaps") — and
// its inner edge must be snapped onto the shape's inward offset (no pixel
// staircase). Verified against the real mesh geometry of every print mode:
//  - coverage: every fine cell inside the silhouette (clear of the outline)
//    carries material from at least one part, and the ring band belongs to
//    exactly the border part(s) of the mode;
//  - relief: in lithophane mode the ring band is the full max thickness;
//  - smoothness: every vertex straddling the ring's inner contour sits
//    exactly on the true offset circle.
console.log("border ring (fine cells, smooth inner edge):");
{
  const BW = 48,
    BH = 48;
  let rng = 13579;
  const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const bpx = new Uint8ClampedArray(BW * BH * 4);
  for (let i = 0; i < BW * BH; i++) {
    const o = i * 4;
    bpx[o] = rnd() * 255;
    bpx[o + 1] = rnd() * 255;
    bpx[o + 2] = rnd() * 255;
    bpx[o + 3] = 255;
  }
  const noiseImage = { data: bpx, width: BW, height: BH } as unknown as ImageData;
  const borderPalette: RGB[] = [
    [30, 30, 30],
    [200, 40, 40],
    [40, 200, 60],
    [240, 240, 235],
  ];
  const shape = { type: "circle" as const, cx: 0.5, cy: 0.5, size: 1 };
  const borderMm = 3.5;
  const widthMm = 48; // 1mm pixels -> border ring is 3.5 fine-ish pixels wide
  const pixelSize = widthMm / BW;
  const borderPx = borderMm / pixelSize;
  const sub = 4;
  const fine = makeFineShapeGrid(makeShapeSilhouette(shape, BW, BH), BW, BH, sub);
  const fw = fine.fw,
    fh = fine.fh;
  const cpx = 0.5 * BW,
    cpy = 0.5 * BH,
    R = 0.5 * Math.min(BW, BH);
  const radiusPx = (cx: number, cy: number): number =>
    Math.hypot(cx - cpx, cy - cpy);

  for (const mode of ["mosaic", "layered", "lithophane", "cmyk"] as const) {
    const proc = processImageData(
      noiseImage,
      borderPalette,
      widthMm,
      5,
      mode,
      0.2,
      0.8,
      { colorLayers: 4, whiteMinLayers: 2, whiteMaxLayers: 10 },
      false,
      { shape, borderMm }
    );

    // Rasterize every part's flat (equal-z) faces onto the fine cells to get
    // per-cell part coverage and the union's top height.
    const partMask = new Uint8Array(fw * fh); // bitmask of parts covering a cell
    const topZ = new Float32Array(fw * fh);
    const inTri = (
      ax: number, ay: number,
      bx: number, by: number,
      cx: number, cy: number,
      px: number, py: number
    ): boolean => {
      const d = (by - ay) * (cx - ax) - (bx - ax) * (cy - ay);
      if (Math.abs(d) < 1e-12) return false;
      const w1 = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / d;
      const w2 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / d;
      const w0 = 1 - w1 - w2;
      return w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9;
    };
    for (let k = 0; k < proc.meshes.length; k++) {
      const m = proc.meshes[k];
      for (let t = 0; t + 8 < m.positions.length; t += 9) {
        // mesh (mm, Y up) -> image pixel coords (row 0 at top) to match the
        // fine cell centers
        const ax = m.positions[t] / pixelSize,
          ay = BH - m.positions[t + 1] / pixelSize,
          az = m.positions[t + 2];
        const bx = m.positions[t + 3] / pixelSize,
          by = BH - m.positions[t + 4] / pixelSize,
          bz = m.positions[t + 5];
        const cx = m.positions[t + 6] / pixelSize,
          cy = BH - m.positions[t + 7] / pixelSize,
          cz = m.positions[t + 8];
        // only flat (top/bottom) faces say anything about XY coverage
        if (!(Math.abs(az - bz) < 1e-9 && Math.abs(bz - cz) < 1e-9)) continue;
        const minX = Math.min(ax, bx, cx),
          maxX = Math.max(ax, bx, cx);
        const minY = Math.min(ay, by, cy),
          maxY = Math.max(ay, by, cy);
        const fx0 = Math.max(0, Math.floor(minX * sub - 0.5));
        const fx1 = Math.min(fw - 1, Math.ceil(maxX * sub));
        const fy0 = Math.max(0, Math.floor(minY * sub - 0.5));
        const fy1 = Math.min(fh - 1, Math.ceil(maxY * sub));
        for (let fy = fy0; fy <= fy1; fy++) {
          for (let fx = fx0; fx <= fx1; fx++) {
            const px = (fx + 0.5) / sub;
            const py = (fy + 0.5) / sub;
            if (!inTri(ax, ay, bx, by, cx, cy, px, py)) continue;
            const i = fy * fw + fx;
            partMask[i] |= 1 << k;
            if (az > topZ[i]) topZ[i] = az;
          }
        }
      }
    }

    let uncovered = 0; // union gaps: real holes in the combined plate
    let wrongRing = 0; // ring band not owned by the mode's border part(s)
    let wrongRingZ = 0; // lithophane: ring band not at max thickness
    let wrongInterior = 0; // mosaic: interior cell claimed by more than one part
    const ringOwnerMask = mode === "cmyk" ? 0b1111 : 1;
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const i = fy * fw + fx;
        if (!fine.inside[i]) continue;
        const px = (fx + 0.5) / sub;
        const py = (fy + 0.5) / sub;
        const edgeDist = R - radiusPx(px, py); // distance to the circle
        if (edgeDist < 2 / sub) continue; // too close to the outline
        const isRing = edgeDist <= borderPx;
        // skip the contour straddle band on both sides: the snapped edge
        // distorts the boundary cells' quads, so cell-center rasterisation
        // is not meaningful there
        if (isRing && edgeDist > borderPx - 2 / sub) continue;
        if (!isRing && edgeDist < borderPx + 2 / sub) continue;
        const mask = partMask[i];
        if (mask === 0) {
          uncovered++;
          continue;
        }
        if (isRing) {
          if (mask !== ringOwnerMask) wrongRing++;
          if (mode === "lithophane" && Math.abs(topZ[i] - 5) > 1e-6) {
            wrongRingZ++;
          }
        } else if (mode === "mosaic" && (mask & (mask - 1)) !== 0) {
          wrongInterior++;
        }
      }
    }
    check(
      uncovered === 0,
      `${mode}: no gaps in the combined plate (${uncovered} uncovered fine cells)`
    );
    check(
      wrongRing === 0,
      `${mode}: border ring band owned by the border part(s) (${wrongRing} wrong cells)`
    );
    if (mode === "lithophane") {
      check(
        wrongRingZ === 0,
        `lithophane: border ring band is full max thickness (${wrongRingZ} wrong cells)`
      );
    }
    if (mode === "mosaic") {
      check(
        wrongInterior === 0,
        `mosaic: interior cells belong to exactly one colour part (${wrongInterior} wrong cells)`
      );
    }

    // Smooth inner edge: every vertex whose 2x2 neighbourhood straddles the
    // ring contour is emitted exactly on the true offset circle.
    let straddle = 0;
    let onContour = 0;
    const meshVertices = new Set<string>();
    for (const m of proc.meshes) {
      for (let t = 0; t < m.positions.length; t += 3) {
        meshVertices.add(
          m.positions[t].toFixed(5) + "," + m.positions[t + 1].toFixed(5)
        );
      }
    }
    for (let vy = 0; vy <= fh; vy++) {
      for (let vx = 0; vx <= fw; vx++) {
        const px = vx / sub;
        const py = vy / sub;
        const d = R - radiusPx(px, py);
        if (Math.abs(d - borderPx) > 1.5 / sub) continue;
        let ringIn = 0;
        let total = 0;
        for (let oy = -1; oy <= 0; oy++) {
          for (let ox = -1; ox <= 0; ox++) {
            const fx = vx + ox;
            const fy = vy + oy;
            if (fx < 0 || fy < 0 || fx >= fw || fy >= fh) continue;
            const i = fy * fw + fx;
            if (!fine.inside[i]) continue;
            total++;
            if (R - radiusPx((fx + 0.5) / sub, (fy + 0.5) / sub) <= borderPx) {
              ringIn++;
            }
          }
        }
        if (!(ringIn > 0 && ringIn < total)) continue;
        // radial projection of the grid vertex onto the offset circle
        const pr = radiusPx(px, py);
        const targetR = R - borderPx;
        const tx = cpx + ((px - cpx) / pr) * targetR;
        const ty = cpy + ((py - cpy) / pr) * targetR;
        straddle++;
        if (
          meshVertices.has(
            (tx * pixelSize).toFixed(5) + "," + ((BH - ty) * pixelSize).toFixed(5)
          )
        ) {
          onContour++;
        }
      }
    }
    check(
      straddle > 8 && onContour === straddle,
      `${mode}: every ring-boundary vertex sits on the true offset circle (${onContour}/${straddle})`
    );
  }
}

console.log("curvature:");
// radius math
check(curveRadius(100, 0) === Infinity, "flat -> infinite radius");
check(
  Math.abs(curveRadius(100, 180) - 100 / Math.PI) < 1e-9,
  "180deg -> R = width / pi"
);

// transform math: single vertex checks via a tiny synthetic mesh
{
  // 1x1 pixel cell, pixelSize 10, top face at z=2
  const pos = [
    0, 0, 2, 10, 0, 2, 10, 10, 2,
    0, 0, 2, 10, 10, 2, 0, 10, 2,
    5, 5, 2, 5, 0, 2, 5, 10, 2, // center column: checks the radial mapping
  ];
  applyCurve(pos, 10, 180);
  const R = 10 / Math.PI;
  // bed placement: min Z = 0
  let minZ = Infinity;
  for (let i = 2; i < pos.length; i += 3) minZ = Math.min(minZ, pos[i]);
  check(Math.abs(minZ) < 1e-6, "curved mesh rests on the bed (min Z = 0)");
  // seam edges (x=0/10 -> phi=+-90deg) sit at |X| = R + 2, center back at z = R
  const xs = pos.filter((_, i) => i % 3 === 0);
  check(
    Math.abs(Math.max(...xs) - (R + 2)) < 1e-6 &&
      Math.abs(Math.min(...xs) + (R + 2)) < 1e-6,
    `180deg half-cylinder spans +/-(R+z) in X`
  );
  // the image height runs along the print's up axis: Z = image Y (0..10)
  const zs = pos.filter((_, i) => i % 3 === 2);
  check(
    Math.abs(Math.min(...zs)) < 1e-6 && Math.abs(Math.max(...zs) - 10) < 1e-6,
    "image height becomes the print height (Z spans 0..10)"
  );
  // the top-center vertex (x=5, z=2) lands on the cylinder's inner surface,
  // straight in front of the axis: X = 0, Y = R - (R + z) = -z
  check(
    pos.some(
      (_, i) =>
        i % 3 === 0 && Math.abs(pos[i]) < 1e-6 && Math.abs(pos[i + 1] + 2) < 1e-6
    ),
    "top-center vertex at (0, -z) on the inner surface"
  );
}

/** Area of horizontal (XY-plane) triangles sitting at the mesh's lowest Z. */
function contactArea(positions: number[]): number {
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) minZ = Math.min(minZ, positions[i]);
  let area = 0;
  for (let t = 0; t + 8 < positions.length; t += 9) {
    if (
      Math.abs(positions[t + 2] - minZ) > 1e-6 ||
      Math.abs(positions[t + 5] - minZ) > 1e-6 ||
      Math.abs(positions[t + 8] - minZ) > 1e-6
    ) {
      continue;
    }
    const ax = positions[t], ay = positions[t + 1];
    const bx = positions[t + 3], by = positions[t + 4];
    const cx = positions[t + 6], cy = positions[t + 7];
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  return area;
}

// integration: curved lithophane stays manifold, stands up and rests on its
// bottom edge. Bambu Studio reported "empty initial layer" + "floating
// regions" because the bent plate only touched the bed along its end lines.
const curvedLitho = processImageData(
  gImage,
  [],
  80,
  4,
  "lithophane",
  0.2,
  0.8,
  undefined,
  false,
  undefined,
  180
);
{
  const bad = countNonManifoldEdges(curvedLitho.meshes[0].positions);
  check(bad === 0, `curved lithophane manifold (${bad} bad edges)`);
  // lamp-shade orientation: the image height is the print's up axis
  // the image's bottom row becomes a flat annulus at z = 0, so the object
  // rests on a real area (width x thickness) instead of a razor-thin line
  const contact = contactArea(curvedLitho.meshes[0].positions);
  check(
    contact > 0.4 * 80 * 0.8 && contact < 80 * 4 + 1,
    `curved lithophane bottom contact area sane (${contact.toFixed(1)} mm2)`
  );
  check(
    Math.abs(curvedLitho.bboxMm.z - 80) < 1e-6,
    `curved lithophane stands on its bottom edge (Z extent = image height, ${curvedLitho.bboxMm.z.toFixed(1)})`
  );
}

// full cylinder (clamped to 359.5deg to keep the seam open)
const cylinder = processImageData(
  quadImage,
  palette,
  40,
  5,
  "mosaic",
  0.2,
  0.8,
  undefined,
  false,
  undefined,
  360
);
for (const m of cylinder.meshes) {
  const bad = countNonManifoldEdges(m.positions);
  check(bad === 0, `cylinder mosaic ${m.name}: manifold (${bad} bad edges)`);
}
// full cylinder: outer diameter = 2 * (R + depth)
check(
  Math.abs(cylinder.bboxMm.x - 2 * (curveRadius(40, 360) + 5)) < 1,
  `full-cylinder outer diameter (${cylinder.bboxMm.x.toFixed(1)})`
);

/** Min radial distance of a layered band's vertices from the bend axis. */
function band2Radial(p: { meshes: { positions: number[] }[] }): number {
  const R = curveRadius(40, 90);
  let rMin = Infinity;
  const b2 = p.meshes[1].positions;
  for (let i = 0; i < b2.length; i += 3) {
    rMin = Math.min(rMin, Math.hypot(b2[i], R - b2[i + 1]));
  }
  return rMin;
}

// regression: curved multi-part plates must share ONE bed translation —
// per-part translation pulled stacked bands out of radial alignment
{
  const cl = processImageData(
    quadImage,
    palette,
    40,
    5,
    "layered",
    0.2,
    0.8,
    undefined,
    false,
    undefined,
    90
  );
  const minZ = (m: { positions: number[] }): number => {
    let z = Infinity;
    for (let i = 2; i < m.positions.length; i += 3) z = Math.min(z, m.positions[i]);
    return z;
  };
  check(
    Math.abs(minZ(cl.meshes[0])) < 1e-6,
    "curved layered: bottom band rests on the bed"
  );
  check(
    Math.abs(band2Radial(cl) - (curveRadius(40, 90) + 1.2)) < 0.02,
    `curved layered: band 2 keeps its radial position (${band2Radial(cl).toFixed(3)}, expect ~${(curveRadius(40, 90) + 1.2).toFixed(3)})`
  );
  for (const m of cl.meshes) {
    const bad = countNonManifoldEdges(m.positions);
    check(bad === 0, `curved layered ${m.name}: manifold (${bad} bad edges)`);
  }
}

console.log("slider text input:");
{
  const P = (raw: string, min: number, max: number, step: number) =>
    parseSliderInput(raw, min, max, step);
  // a pasted unit is tolerated — the number is what matters
  check(P("12 mm", 0, 20, 0.5) === 12, "typed value ignores a unit suffix");
  check(P("12mm", 0, 20, 0.5) === 12, "typed value with a glued unit parses");
  check(P("150%", 5, 150, 5) === 150, "typed percent parses (and may reach max)");
  check(P(" 0.2 ", 0.08, 0.3, 0.04) === 0.2, "surrounding whitespace is ignored");
  // clamped into the slider's range, never outside the state the UI allows
  check(P("900", 32, 512, 8) === 512, "typed value above max clamps to max");
  check(P("-4", 0, 5, 0.25) === 0, "typed value below min clamps to min");
  check(P("0.31", 0.08, 0.3, 0.04) === 0.3, "typed value past the last step clamps to max");
  // snapped onto the slider's own grid (min + k*step), without float noise
  check(P("0.3", 0, 5, 0.25) === 0.25, "typed value snaps to the step grid");
  check(P("0.16", 0.08, 0.3, 0.04) === 0.16, "snapped value carries no float noise");
  check(P("0.4", 0, 5, 0.25) === 0.5, "typed value rounds to the nearer step");
  check(P("3", 1, 8, 1) === 3, "typed integer passes through");
  // junk reverts rather than zeroing the setting
  check(P("", 0, 5, 0.5) === null, "empty entry reverts");
  check(P("abc", 0, 5, 0.5) === null, "non-numeric entry reverts");
  check(P("--", 0, 5, 0.5) === null, "punctuation-only entry reverts");
  // commit rules: what a committed entry does to the value (null = leave it)
  const C = (
    raw: string,
    value: number,
    min: number,
    max: number,
    step: number,
    cancelled = false
  ) => resolveSliderCommit(raw, value, min, max, step, cancelled);
  check(C("0.6", 0.8, 0.4, 2, 0.2) === 0.6, "commit applies a typed value");
  check(C("0.8", 0.8, 0.4, 2, 0.2) === null, "commit of the same value is a no-op");
  check(C("0.6", 0.8, 0.4, 2, 0.2, true) === null, "Esc cancels the entry");
  check(C("", 0.8, 0.4, 2, 0.2) === null, "commit of an empty field is a no-op");
  check(C("abc", 0.8, 0.4, 2, 0.2) === null, "commit of junk is a no-op");
  check(C("0.31", 0.8, 0.08, 0.3, 0.04) === 0.3, "commit clamps and snaps");

  // display side
  check(
    stepDecimals(5) === 0 && stepDecimals(0.25) === 2 && stepDecimals(0.04) === 2,
    "step decimals are derived from the step"
  );
  check(
    formatSliderValue(0.30000000000000004, 0.2) === "0.3",
    "display hides float noise"
  );
  check(formatSliderValue(2, 0.5) === "2", "display drops trailing zeros");
  check(
    formatSliderValue(92.5, 5) === "92.5",
    "display shows the real value, not a snapped one"
  );
  // every pair of values in the app must survive the field: what it shows has
  // to parse back to the same number, or editing one field would silently
  // move a setting the user never touched
  const sliders: [number, number, number, number][] = [
    [4, 2, 16, 1], // number of colors
    [120, 32, 512, 8], // resolution
    [80, 5, 150, 5], // shape size (%)
    [80, 5, 100, 5], // custom crop (%)
    [1.5, 0, 5, 0.25], // border width
    [180, 0, 360, 10], // curvature
    [100, 40, 300, 5], // plate width
    [0.8, 0.4, 2, 0.2], // min thickness
    [5, 2, 12, 0.5], // plate depth
    [16, 4, 30, 1], // white layers (max)
    [0.2, 0.08, 0.3, 0.04], // print layer height
  ];
  check(
    sliders.every(
      ([v, mn, mx, st]) => P(formatSliderValue(v, st), mn, mx, st) === v
    ),
    "display → parse round trip is lossless for every slider"
  );
  // ... and so does a typed value on the step grid, clamped to the range
  const grid = (v: number, mn: number, mx: number, st: number) => {
    const k = Math.round((v - mn) / st);
    const onGrid = Number((mn + k * st).toFixed(6));
    return onGrid >= mn && onGrid <= mx && P(String(onGrid), mn, mx, st) === onGrid;
  };
  check(
    sliders.every(([, mn, mx, st]) => {
      let all = true;
      for (let v = mn; v <= mx + 1e-9; v += st) all = all && grid(v, mn, mx, st);
      return all;
    }),
    "every value on every slider's step grid round trips"
  );
}

console.log("terrain / geo:");
check(
  Math.abs(tileXToLng(lngToTileX(11.5, 10), 10) - 11.5) < 1e-9,
  "lng -> tileX -> lng round trip"
);
check(
  Math.abs(tileYToLat(latToTileY(46.5, 10), 10) - 46.5) < 1e-6,
  "lat -> tileY -> lat round trip"
);

const trSmall = bboxFromCenter({ lat: 46.5, lng: 7.9 }, 2000, 2000);
const trBig = bboxFromCenter({ lat: 46.5, lng: 7.9 }, 200000, 200000);
check(
  zoomForTargetPixels(trSmall, 160) > zoomForTargetPixels(trBig, 160),
  "smaller selection -> higher tile zoom"
);
check(
  zoomForTargetPixels(trSmall, 160) <= 15,
  "terrain zoom clamps to 15"
);

const trGs = groundSizeMeters(bboxFromCenter({ lat: 40, lng: -3 }, 10000, 5000));
check(
  Math.abs(trGs.widthM - 10000) < 60 && Math.abs(trGs.heightM - 5000) < 60,
  `bboxFromCenter keeps ground size (${trGs.widthM.toFixed(0)}x${trGs.heightM.toFixed(0)} m)`
);

const trRange = tileRangeForBbox(trSmall, zoomForTargetPixels(trSmall, 160));
check(trRange.nx >= 1 && trRange.ny >= 1, "tile range non-empty");

const trEnc = (e: number): [number, number, number] => {
  const v = e + 32768;
  return [
    Math.floor(v / 256),
    Math.floor(v % 256),
    Math.floor((v - Math.floor(v)) * 256),
  ];
};
const [trEr, trEg, trEb] = trEnc(1234.5);
check(
  Math.abs(decodeTerrarium(trEr, trEg, trEb) - 1234.5) < 1 / 128,
  `terrarium decode round trip (${decodeTerrarium(trEr, trEg, trEb)})`
);

const trRamp = new Float32Array(64);
for (let i = 0; i < 64; i++) trRamp[i] = i;
const trResampled = resampleBilinear(trRamp, 8, 8, 0, 0, 8, 8, 4, 4);
let trMono = true;
for (let i = 1; i < trResampled.length; i++)
  if (trResampled[i] < trResampled[i - 1]) trMono = false;
check(trResampled.length === 16 && trMono, "resample keeps a monotonic ramp");

const trNe = normFromElevations(new Float32Array([0, 50, 100]), 0, 100);
check(
  Math.abs(trNe[0]) < 1e-6 &&
    Math.abs(trNe[1] - 0.5) < 1e-6 &&
    Math.abs(trNe[2] - 1) < 1e-6,
  "normFromElevations scales 0..1"
);

const trGw = 16;
const trGh = 12;
const trN = trGw * trGh;
const trNorm = new Float32Array(trN);
for (let i = 0; i < trN; i++) trNorm[i] = (i % trGw) / (trGw - 1); // left->right ramp
const trOpts = {
  widthMm: 80,
  reliefMm: 20,
  baseMm: 2,
  layerHeight: 0,
  seaLevelNorm: 0,
  color: [150, 150, 150] as RGB,
  bands: 1,
  bandColors: [] as RGB[],
  frame: null,
};
const terrainSingle = buildTerrainFromHeights(trNorm, trGw, trGh, trOpts);
check(
  countNonManifoldEdges(terrainSingle.parts[0].positions) === 0,
  "terrain single part is manifold"
);
check(
  Math.abs(terrainSingle.bboxMm.z - 22) < 1e-6,
  `terrain height = base + relief (${terrainSingle.bboxMm.z})`
);
check(
  Math.abs(terrainSingle.bboxMm.x - 80) < 1e-6,
  `terrain width = 80 mm (${terrainSingle.bboxMm.x})`
);

const terrainSea = buildTerrainFromHeights(trNorm, trGw, trGh, {
  ...trOpts,
  seaLevelNorm: 0.5,
});
let trSeaMin = Infinity;
for (const v of terrainSea.norm) if (v < trSeaMin) trSeaMin = v;
check(
  Math.abs(trSeaMin - 0.5) < 1e-6,
  `sea level raises the floor to 0.5 (${trSeaMin})`
);

const terrainBanded = buildTerrainFromHeights(trNorm, trGw, trGh, {
  ...trOpts,
  bands: 3,
  bandColors: [
    [0, 0, 255],
    [0, 255, 0],
    [255, 0, 0],
  ] as RGB[],
});
let trBandBad = 0;
for (const p of terrainBanded.parts) trBandBad += countNonManifoldEdges(p.positions);
check(
  terrainBanded.parts.length === 3 && trBandBad === 0,
  `colour bands nest into 3 manifold parts (${terrainBanded.parts.length}, ${trBandBad} bad)`
);

const terrainFramed = buildTerrainFromHeights(trNorm, trGw, trGh, {
  ...trOpts,
  frame: { widthMm: 4, color: [60, 60, 60] as RGB },
});
const trFwCells = Math.max(1, Math.round(4 / (80 / trGw)));
check(
  terrainFramed.parts.length === 2,
  `base plate adds a part (${terrainFramed.parts.length})`
);
check(
  countNonManifoldEdges(terrainFramed.parts[0].positions) === 0,
  "framed relief is manifold"
);
check(
  countNonManifoldEdges(terrainFramed.parts[1].positions) === 0,
  "base plate is manifold"
);
check(
  Math.abs(terrainFramed.bboxMm.x - (80 + 2 * trFwCells * (80 / trGw))) < 1e-6,
  `base plate widens the footprint (${terrainFramed.bboxMm.x})`
);

// many distinct z values per cell: stresses the windowed cut iteration in
// emitStrips (a naive all-cuts scan would be O(cells * distinctZ)).
const tzGw = 40;
const tzGh = 30;
const tzNorm = new Float32Array(tzGw * tzGh);
for (let i = 0; i < tzNorm.length; i++) tzNorm[i] = i / (tzNorm.length - 1);
const tzTerrain = buildTerrainFromHeights(tzNorm, tzGw, tzGh, {
  ...trOpts,
  widthMm: 80,
  reliefMm: 20,
});
check(
  countNonManifoldEdges(tzTerrain.parts[0].positions) === 0,
  "many-distinct-z heightfield is manifold"
);
check(
  Math.abs(tzTerrain.bboxMm.z - 22) < 1e-6,
  `many-distinct-z heightfield height = base + relief (${tzTerrain.bboxMm.z})`
);

console.log("buildings:");
check(
  buildingHeight({ ring: [], heightM: 24 }, 3, 10) === 24,
  "building height: explicit height tag wins"
);
check(
  buildingHeight({ ring: [], levels: 5 }, 3, 10) === 15,
  "building height: levels x metresPerLevel"
);
check(
  buildingHeight({ ring: [] }, 3, 10) === 10,
  "building height: default fallback"
);

const bctx: BuildingContext = {
  west: 0,
  south: 0,
  east: 0.01,
  north: 0.01,
  widthMm: 100,
  heightMm: 100,
  metresToMm: 1,
  heightScale: 1,
  metresPerLevel: 3,
  defaultHeightM: 10,
  groundZ: () => 5,
};
const bfootprints: BuildingFootprint[] = [
  {
    ring: [
      [0.002, 0.002],
      [0.006, 0.002],
      [0.006, 0.006],
      [0.002, 0.006],
    ],
    heightM: 20,
  },
  {
    ring: [
      [0.007, 0.007],
      [0.009, 0.007],
      [0.009, 0.009],
    ],
    levels: 4,
  },
];
const bparts = buildBuildingParts(bfootprints, bctx, [130, 130, 135]);
check(bparts.length === 1, `buildings build one part (${bparts.length})`);
check(
  countNonManifoldEdges(bparts[0].positions) === 0,
  "buildings part is manifold"
);
check(
  Math.abs(bparts[0].z1 - 25) < 1e-6,
  `building top = ground + height (${bparts[0].z1})`
);
check(
  Math.abs(bparts[0].z0 - 4.4) < 1e-6,
  `building base sunk into the ground (${bparts[0].z0})`
);
const bdeg = buildBuildingParts(
  [
    {
      ring: [
        [0, 0],
        [0.001, 0.001],
        [0.002, 0.002],
      ],
    },
  ],
  bctx,
  [130, 130, 135]
);
check(bdeg.length === 0, "degenerate (collinear) footprint is skipped");

console.log("badge / coaster:");
// badge: shaped plate + raised text from synthetic masks
const bGw = 64;
const bGh = 32;
const badgePlateMask = new Uint8Array(bGw * bGh);
for (let y = 4; y < bGh - 4; y++)
  for (let x = 4; x < bGw - 4; x++) badgePlateMask[y * bGw + x] = 1;
const badgeTextMask = new Uint8Array(bGw * bGh);
for (let y = 12; y < bGh - 12; y++)
  for (let x = 16; x < bGw - 16; x++) badgeTextMask[y * bGw + x] = 1;
const badgeRes = buildBadgeFromMasks(
  badgePlateMask,
  badgeTextMask,
  bGw,
  bGh,
  0.5,
  {
    plateMm: 3,
    textMm: 1,
    textStyle: "raised",
    plateColor: [0, 0, 255] as RGB,
    textColor: [255, 255, 255] as RGB,
  }
);
check(
  badgeRes.parts.length === 2,
  `badge has plate + text parts (${badgeRes.parts.length})`
);
let badgeBad = 0;
for (const p of badgeRes.parts) badgeBad += countNonManifoldEdges(p.positions);
check(badgeBad === 0, `badge parts manifold (${badgeBad} bad edges)`);
check(
  Math.abs(badgeRes.bboxMm.z - 4) < 1e-6,
  `badge depth = plate + text (${badgeRes.bboxMm.z})`
);

// engraved: single plate-colour part, text recessed, plate depth unchanged
const badgeEngraved = buildBadgeFromMasks(
  badgePlateMask,
  badgeTextMask,
  bGw,
  bGh,
  0.5,
  {
    plateMm: 3,
    textMm: 1,
    textStyle: "engraved",
    plateColor: [0, 0, 255] as RGB,
    textColor: [255, 255, 255] as RGB,
  }
);
check(
  badgeEngraved.parts.length === 1,
  `engraved badge has one part (${badgeEngraved.parts.length})`
);
let engravedBad = 0;
for (const p of badgeEngraved.parts)
  engravedBad += countNonManifoldEdges(p.positions);
check(engravedBad === 0, `engraved badge part manifold (${engravedBad} bad edges)`);
check(
  Math.abs(badgeEngraved.bboxMm.z - 3) < 1e-6,
  `engraved badge depth = plate only (${badgeEngraved.bboxMm.z})`
);

// keyring hole placement: shapes whose top is concave (heart) or pointy (star)
// would otherwise get no hole at all — the disc lands in the notch / point.
const rGw = 40;
const rGh = 3;
const runsMask = new Uint8Array(rGw * rGh);
for (let x = 2; x <= 9; x++) runsMask[1 * rGw + x] = 1;
for (let x = 20; x <= 39; x++) runsMask[1 * rGw + x] = 1;
const rcLeft = runCentre(runsMask, rGw, rGh, 1, 0, 19);
check(Math.abs(rcLeft - 6) < 1e-6, `runCentre finds the left run (${rcLeft})`);
const rcWide = runCentre(runsMask, rGw, rGh, 1, 0, 39);
check(Math.abs(rcWide - 30) < 1e-6, `runCentre picks the widest run (${rcWide})`);

const solidMask = new Uint8Array(60 * 60).fill(1);
const solidHole = fitHole(solidMask, 60, 60, 30, 20, 8, 1);
check(
  Math.round(solidHole[0] - 0.5) === 30 && Math.round(solidHole[1] - 0.5) === 20,
  `fitHole keeps a position that already fits (${solidHole[0]},${solidHole[1]})`
);

const hGw = 120;
const hGh = 80;
const notchMask = new Uint8Array(hGw * hGh);
for (let y = 0; y < hGh; y++)
  for (let x = 0; x < hGw; x++) {
    const halfW = Math.min(58, 6 + y * 1.8);
    const gapPx = y < 24 ? (24 - y) * 1.2 : 0; // V notch at the top centre
    if (Math.abs(x - 60) < halfW && Math.abs(x - 60) >= gapPx)
      notchMask[y * hGw + x] = 1;
  }
const notchDist = chamferToZero(notchMask, hGw, hGh);
check(
  notchDist[13 * hGw + 60] === 0,
  "heart-like top centre has no material (a hole there would vanish)"
);
// old behaviour: punch at the top centre (4 mm inset, 5 mm hole @ 0.5 mm/px)
const naiveMask = notchMask.slice();
clearCircle(naiveMask, hGw, hGh, 60, 13, 5);
let naiveRemoved = 0;
for (let i = 0; i < naiveMask.length; i++) naiveRemoved += notchMask[i] - naiveMask[i];
// new behaviour: aim at the lobe, then slide down until the disc fits
const lobeX = runCentre(notchMask, hGw, hGh, 13, 0, 59);
check(lobeX !== 60, `heart-like hole aims at a lobe, not the notch (x ${lobeX})`);
const heartHole = fitHole(notchMask, hGw, hGh, lobeX, 13, 5, 1);
const fittedMask = notchMask.slice();
clearCircle(fittedMask, hGw, hGh, heartHole[0], heartHole[1], 5);
let fittedRemoved = 0;
for (let i = 0; i < fittedMask.length; i++)
  fittedRemoved += notchMask[i] - fittedMask[i];
const heartClearance =
  notchDist[
    Math.round(heartHole[1] - 0.5) * hGw + Math.round(heartHole[0] - 0.5)
  ];
check(
  naiveRemoved === 0 && fittedRemoved > 60,
  `heart-like hole removes material (${naiveRemoved} px before -> ${fittedRemoved} px now)`
);
check(
  heartClearance >= 5,
  `heart-like hole sits fully inside the material (clearance ${heartClearance.toFixed(1)} px)`
);


const cGw = 48;
const cGh = 48;
const coasterShapeMask = new Uint8Array(cGw * cGh);
for (let y = 0; y < cGh; y++)
  for (let x = 0; x < cGw; x++) {
    const dx = x - cGw / 2;
    const dy = y - cGh / 2;
    if (dx * dx + dy * dy <= (cGw / 2 - 1) ** 2)
      coasterShapeMask[y * cGw + x] = 1;
  }
const coasterGrid = new Uint8Array(cGw * cGh);
for (let i = 0; i < coasterGrid.length; i++)
  coasterGrid[i] = i % cGw < cGw / 2 ? 0 : 1;
const coasterImg = { data: new Uint8ClampedArray(cGw * cGh * 4).fill(200) };
const coasterOpts = {
  shape: "circle" as const,
  sizeMm: 100,
  baseMm: 3,
  rimMm: 2,
  cornerMm: 0,
  mode: "mosaic" as const,
  depthMm: 1,
  resolution: cGw,
  baseColor: [24, 24, 27] as RGB,
  palette: [
    [255, 0, 0],
    [0, 255, 0],
  ] as RGB[],
  reliefInvert: false,
};
const coasterRes = buildCoasterFromGrid(
  coasterGrid,
  coasterImg,
  coasterShapeMask,
  cGw,
  cGh,
  2,
  coasterOpts
);
check(
  coasterRes.parts.length === 3,
  `mosaic coaster = base + 2 colours (${coasterRes.parts.length})`
);
let coasterBad = 0;
for (const p of coasterRes.parts)
  coasterBad += countNonManifoldEdges(p.positions);
check(coasterBad === 0, `mosaic coaster parts manifold (${coasterBad} bad edges)`);

const reliefRes = buildCoasterFromGrid(
  coasterGrid,
  coasterImg,
  coasterShapeMask,
  cGw,
  cGh,
  2,
  { ...coasterOpts, mode: "relief", palette: [] }
);
check(
  reliefRes.parts.length === 1,
  `relief coaster is a single part (${reliefRes.parts.length})`
);
check(
  countNonManifoldEdges(reliefRes.parts[0].positions) === 0,
  "relief coaster is manifold"
);

// The mesher splits every wall at every distinct z in the part, so a
// continuous relief (one height per cell) explodes into millions of triangles
// and freezes the preview. Relief heights must stay snapped to a few steps.
const noisyImg = { data: new Uint8ClampedArray(cGw * cGh * 4) };
for (let i = 0; i < cGw * cGh; i++) {
  const v = (i * 37) % 256; // a different luminance in (almost) every cell
  noisyImg.data[i * 4] = v;
  noisyImg.data[i * 4 + 1] = v;
  noisyImg.data[i * 4 + 2] = v;
  noisyImg.data[i * 4 + 3] = 255;
}
const noisyRelief = buildCoasterFromGrid(
  coasterGrid,
  noisyImg,
  coasterShapeMask,
  cGw,
  cGh,
  2,
  { ...coasterOpts, mode: "relief", palette: [] }
);
const reliefLevels = new Set<number>();
for (const v of noisyRelief.relief!) reliefLevels.add(Math.round(v * 1e6) / 1e6);
check(
  reliefLevels.size <= RELIEF_LEVELS + 2,
  `relief snaps to few z levels (${reliefLevels.size})`
);
const reliefCells = coasterShapeMask.reduce((s, m) => s + m, 0);
const trisPerCell = noisyRelief.triangleCount / reliefCells;
check(
  trisPerCell < 60,
  `relief mesh stays small (${trisPerCell.toFixed(1)} triangles/cell, was 252 un-snapped)`
);

console.log("exports:");
async function main() {
  // 3MF from the mosaic parts
  const parts = meshPartPositions(mosaic);
  const blob = await build3MF(parts);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  check(names.includes("[Content_Types].xml"), "3MF contains [Content_Types].xml");
  check(names.includes("_rels/.rels"), "3MF contains _rels/.rels");
  check(names.includes("3D/3dmodel.model"), "3MF contains 3D/3dmodel.model");
  const model = await zip.file("3D/3dmodel.model")!.async("string");
  check((model.match(/<object /g) || []).length === 4, "3MF has 4 objects");
  check((model.match(/<item /g) || []).length === 4, "3MF build has 4 items");
  check(
    (model.match(/<m:colorgroup /g) || []).length === 1,
    "3MF has 1 colorgroup"
  );
  check(
    (model.match(/<m:color /g) || []).length === 4,
    "3MF colorgroup has 4 colors"
  );
  check(
    (model.match(/pid="1" pindex=/g) || []).length === 4,
    "all 4 objects reference the colorgroup"
  );
  const triCount = (model.match(/<triangle /g) || []).length;
  const coloredTris = (model.match(/pid="1" p1="\d+"\/>/g) || []).length;
  check(
    triCount > 0 && triCount === coloredTris,
    `every triangle carries colorgroup pid/p1 (${coloredTris}/${triCount})`
  );
  check(model.includes('unit="millimeter"'), "3MF units are millimetres");
  check(/<m:color color="#[0-9A-F]{8}"/.test(model), "3MF colors are #RRGGBBAA");

  // Bambu Studio metadata: extruder mapping + filament colors
  check(
    names.includes("Metadata/model_settings.config"),
    "3MF contains Metadata/model_settings.config"
  );
  check(
    names.includes("Metadata/project_settings.config"),
    "3MF contains Metadata/project_settings.config"
  );
  const ms = await zip.file("Metadata/model_settings.config")!.async("string");
  check((ms.match(/<object /g) || []).length === 4, "model_settings has 4 objects");
  for (let e = 1; e <= 4; e++) {
    check(
      ms.includes(`key="extruder" value="${e}"`),
      `model_settings assigns extruder ${e}`
    );
  }
  const ps = JSON.parse(
    await zip.file("Metadata/project_settings.config")!.async("string")
  );
  check(
    Array.isArray(ps.filament_colour) && ps.filament_colour.length === 4,
    "project settings: 4 filament colours"
  );
  check(
    Array.isArray(ps.nozzle_diameter) &&
      ps.nozzle_diameter.length === 4 &&
      ps.nozzle_diameter.every((d: string) => d === "0.4"),
    "nozzle_diameter: 4 entries (Bambu config validity check)"
  );
  check(
    Array.isArray(ps.extruder_type) && ps.extruder_type.length === 4,
    "extruder_type: 4 entries matching nozzle_diameter size"
  );

  // lithophane 3MF = single part
  const lithoBlob = await build3MF(meshPartPositions(litho));
  const lithoZip = await JSZip.loadAsync(await lithoBlob.arrayBuffer());
  const lithoModel = await lithoZip.file("3D/3dmodel.model")!.async("string");
  check(
    (lithoModel.match(/<object /g) || []).length === 1,
    "lithophane 3MF has 1 object"
  );
  check(
    (lithoModel.match(/<m:color /g) || []).length === 1,
    "lithophane 3MF colorgroup has 1 color"
  );

  // CMYK 3MF = 4 ordered parts
  const cmykBlob = await build3MF(meshPartPositions(cmykProc));
  const cmykZip = await JSZip.loadAsync(await cmykBlob.arrayBuffer());
  const cmykModel = await cmykZip.file("3D/3dmodel.model")!.async("string");
  check(
    (cmykModel.match(/<object /g) || []).length === 4,
    "CMYK 3MF has 4 objects"
  );
  check(
    /Cyan/.test(cmykModel) && /Magenta/.test(cmykModel) && /Yellow/.test(cmykModel) && /White/.test(cmykModel),
    "CMYK 3MF part names present"
  );

  // binary STL layout
  const stl = buildSTL(parts[0].positions);
  const tris = parts[0].positions.length / 9;
  check(
    stl.byteLength === 84 + tris * 50,
    `binary STL size correct (${stl.byteLength})`
  );
  check(new DataView(stl).getUint32(80, true) === tris, "STL triangle count header");

  // STL zip with one file per color
  const zipBlob = await buildSTLZip(parts);
  const szip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  check(
    Object.keys(szip.files).filter((n) => n.endsWith(".stl")).length === 4,
    "STL zip contains 4 files"
  );

  // variable count 3MF export (e.g. 6-part export)
  const p6 = autoPalette(collectPixels(data), 6);
  const mosaic6 = processImageData(quadImage, p6, 40, 5, "mosaic");
  const p6Parts = meshPartPositions(mosaic6);
  check(p6Parts.length === 6, "6-part positions length is 6");
  const m6Blob = await build3MF(p6Parts);
  const m6Zip = await JSZip.loadAsync(await m6Blob.arrayBuffer());
  const m6Model = await m6Zip.file("3D/3dmodel.model")!.async("string");
  check(
    (m6Model.match(/<object /g) || []).length === 6,
    "6-color 3MF has 6 objects"
  );
  check(
    (m6Model.match(/<m:color /g) || []).length === 6,
    "6-color 3MF colorgroup has 6 colors"
  );
  check(
    m6Model.includes("<metadata name=\"Title\">6-color image print</metadata>"),
    "6-color 3MF metadata title is 6-color"
  );
  const m6ms = await m6Zip.file("Metadata/model_settings.config")!.async("string");
  check((m6ms.match(/<object /g) || []).length === 6, "6-color model_settings has 6 objects");
  const m6ps = JSON.parse(await m6Zip.file("Metadata/project_settings.config")!.async("string"));
  check(m6ps.filament_colour.length === 6, "6-color project settings has 6 filament colours");
  check(m6ps.nozzle_diameter.length === 6, "6-color project settings has 6 nozzle diameters");

  // terrain export: terrain + frame parts bundle into one 3MF
  const terrBlob = await build3MF(terrainFramed.parts);
  const terrZip = await JSZip.loadAsync(await terrBlob.arrayBuffer());
  const terrModel = await terrZip.file("3D/3dmodel.model")!.async("string");
  check(
    (terrModel.match(/<object /g) || []).length === 2,
    "terrain 3MF has 2 objects (terrain + frame)"
  );
  check(
    /Terrain/.test(terrModel) && /Base plate/.test(terrModel),
    "terrain 3MF part names present"
  );


  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
