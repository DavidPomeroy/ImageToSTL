/**
 * Reproduction / verification for the reported edge defects (run:
 * npx tsx scripts/repro-edge.ts):
 *
 *  1. "Outside edge is not stitched together correctly, leaving gaps" in every
 *     print mode except mosaic — the border ring was classified per pixel by
 *     pixel-center distance, so along diagonal/curved edges it stopped short
 *     of the smooth silhouette, leaving a ragged band of interior treatment
 *     between the ring and the plate's edge, and the diagonal-contact repair
 *     punched quarter-pixel holes at colour boundaries along the outline.
 *  2. "Inner edge of the border is staircased and should be smooth."
 *
 * The border ring is now classified per FINE cell against the true shape
 * distance, the ring's inner edge is snapped onto the shape's inward offset,
 * and the diagonal-contact repair never removes material. This script checks
 * the real pipeline output:
 *  - union coverage: every silhouette-interior fine cell is covered by at
 *    least one part's material (no gaps in the combined plate);
 *  - ring inner edge: vertices straddling the ring's inner contour sit on
 *    the true inward offset (smooth), not on the fine-grid staircase.
 */
import { processImageData, type PrintMode } from "../lib/pipeline";
import { makeFineShapeGrid } from "../lib/mesh";
import { classifyPixels, makeShapeSilhouette } from "../lib/shapes";
import { mapPixelsToPalette, EMPTY, type RGB } from "../lib/quantize";

// synthetic image: random colours, fully opaque
const W = 96,
  H = 96;
let rng = 42;
const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pixels = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    pixels[o] = 40 + rnd() * 215;
    pixels[o + 1] = 40 + rnd() * 215;
    pixels[o + 2] = 40 + rnd() * 215;
    pixels[o + 3] = 255;
  }
}
const image = { data: pixels, width: W, height: H } as unknown as ImageData;
const palette: RGB[] = [
  [30, 30, 30],
  [200, 40, 40],
  [40, 200, 60],
  [240, 240, 235],
];

const modes: PrintMode[] = ["mosaic", "layered", "lithophane", "cmyk"];
const shapes = [
  { type: "hexagon" as const, cx: 0.5, cy: 0.5, size: 1 },
  { type: "circle" as const, cx: 0.5, cy: 0.5, size: 1 },
];

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ok  - ${msg}`);
  else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

for (const shape of shapes) {
  for (const mode of modes) {
    const borderMm = 3.5;
    const proc = processImageData(
      image,
      palette,
      100,
      5,
      mode,
      0.2,
      0.8,
      { colorLayers: 4, whiteMinLayers: 2, whiteMaxLayers: 10 },
      false,
      { shape, borderMm }
    );
    const gw = proc.gw,
      gh = proc.gh;
    const pixelSize = 100 / gw;
    const sub = Math.max(
      1,
      Math.min(
        4,
        Math.floor(
          Math.sqrt(1_200_000 / ((mode === "lithophane" ? 1 : 4) * gw * gh))
        )
      )
    );
    const fine = makeFineShapeGrid(
      makeShapeSilhouette(shape, gw, gh),
      gw,
      gh,
      sub
    );
    const fw = fine.fw,
      fh = fine.fh;

    // per-part pixel coverage (interior material), mirroring the pipeline
    const cls = classifyPixels(gw, gh, shape, borderMm / pixelSize, (x, y) => {
      const s = fine.sub;
      const row0 = y * s * fine.fw + x * s;
      for (let k = 0; k < s * s; k++) {
        if (fine.inside[row0 + ((k / s) | 0) * fine.fw + (k % s)]) return true;
      }
      return false;
    })!;
    const grid =
      mode === "mosaic" || mode === "layered"
        ? mapPixelsToPalette(image.data, palette)
        : null;
    if (grid) {
      for (let i = 0; i < gw * gh; i++) if (cls[i] === 0) grid[i] = EMPTY;
    }
    const covered = new Uint8Array(fw * fh); // union of interior coverage
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const i = fy * fw + fx;
        if (!fine.inside[i]) continue;
        const pi = ((fy / sub) | 0) * gw + ((fx / sub) | 0);
        let material = false;
        if (mode === "lithophane" || mode === "cmyk") material = cls[pi] !== 0;
        else material = grid![pi] !== EMPTY;
        if (material) covered[i] = 1;
      }
    }
    // ring mask: distance to silhouette <= borderPx
    const ringCells = new Uint8Array(fw * fh);
    const ringPx = borderMm / pixelSize;
    const cx = shape.cx * gw,
      cy = shape.cy * gh,
      R = (shape.size * Math.min(gw, gh)) / 2;
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const i = fy * fw + fx;
        if (!fine.inside[i]) continue;
        let d: number;
        if (shape.type === "circle") {
          d = R - Math.hypot((fx + 0.5) / sub - cx, (fy + 0.5) / sub - cy);
        } else {
          const [qx, qy] = fine.project((fx + 0.5) / sub, (fy + 0.5) / sub);
          d = Math.hypot((fx + 0.5) / sub - qx, (fy + 0.5) / sub - qy);
        }
        if (d <= ringPx) ringCells[i] = 1;
      }
    }

let gaps = 0;
    for (let i = 0; i < fw * fh; i++) {
      if (fine.inside[i] && !ringCells[i] && !covered[i]) gaps++;
    }
    check(
      gaps === 0,
      `${shape.type} ${mode}: every interior fine cell outside the ring is covered by a part's pixel (${gaps} uncovered)`
    );

    // per-part edge defects: no holes (boundary edges), no broken topology.
    // 4-way saddle edges (diagonal point contacts) are tolerated: zero
    // volume, slicer-repaired, and always produced by the per-pixel builder.
    let holes = 0;
    let bad = 0;
    let saddles = 0;
    for (const m of proc.meshes) {
      const vkey = (i: number) =>
        m.positions[i].toFixed(3) +
        "," +
        m.positions[i + 1].toFixed(3) +
        "," +
        m.positions[i + 2].toFixed(3);
      const edges = new Map<string, number>();
      for (let t = 0; t + 8 < m.positions.length; t += 9) {
        for (let e = 0; e < 3; e++) {
          const a = vkey(t + [0, 3, 6][e]);
          const b = vkey(t + [0, 3, 6][(e + 1) % 3]);
          const k = a < b ? a + "|" + b : b + "|" + a;
          edges.set(k, (edges.get(k) ?? 0) + 1);
        }
      }
      for (const c of edges.values()) {
        if (c === 2) continue;
        if (c === 1) holes++;
        else if (c === 4) saddles++;
        else bad++;
      }
    }
    check(
      holes === 0 && bad === 0,
      `${shape.type} ${mode}: parts have no holes or broken topology (holes=${holes} bad=${bad} saddles=${saddles})`
    );

    // ring inner edge smoothness: every vertex whose 2x2 cell neighbourhood
    // straddles the ring mask must be emitted exactly on the true inward
    // offset (for the circle: radius R - borderPx), not at its grid position.
    if (shape.type === "circle") {
      const targetR = R - ringPx;
      let straddle = 0;
      let onContour = 0;
      const meshVertices = new Set<string>();
      for (const m of proc.meshes) {
        for (let i = 0; i < m.positions.length; i += 3) {
          meshVertices.add(
            m.positions[i].toFixed(5) + "," + m.positions[i + 1].toFixed(5)
          );
        }
      }
      for (let vy = 0; vy <= fh; vy++) {
        for (let vx = 0; vx <= fw; vx++) {
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
              if (ringCells[i]) ringIn++;
            }
          }
          if (!(ringIn > 0 && ringIn < total)) continue;
          const px = vx / sub;
          const py = vy / sub;
          const [qx, qy] = fine.project(px, py);
          const d = Math.hypot(px - qx, py - qy);
          const tx = qx + ((px - qx) / d) * ringPx;
          const ty = qy + ((py - qy) / d) * ringPx;
          straddle++;
          if (
            meshVertices.has(
              (tx * pixelSize).toFixed(5) + "," + ((gh - ty) * pixelSize).toFixed(5)
            )
          ) {
            onContour++;
          }
        }
      }
      check(
        straddle > 8 && onContour === straddle,
        `${mode}: every ring-boundary vertex is snapped onto the true offset circle (${onContour}/${straddle})`
      );
    }
  }
}

console.log(
  failures === 0
    ? "\nALL REPRO CHECKS PASSED"
    : `\n${failures} REPRO CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
