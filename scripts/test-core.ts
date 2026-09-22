/**
 * Core-logic smoke test (run: npx tsx scripts/test-core.ts)
 * Builds a small synthetic image, quantizes it, generates meshes,
 * and validates the STL + 3MF output structure.
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
import { buildRectsForColor, meshPositions, rectsToBoxes } from "../lib/mesh";
import { build3MF, buildSTL, buildSTLZip } from "../lib/exporters";
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

// --- Build a synthetic 8x8 RGBA image: 4 quadrant colors + transparent corner
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
    let c: RGB;
    if (x < 4 && y < 4) c = RED;
    else if (x >= 4 && y < 4) c = GREEN;
    else if (x < 4 && y >= 4) c = BLUE;
    else c = WHITE;
    // add slight noise so median cut has something to chew on
    data[o] = Math.min(255, Math.max(0, c[0] + ((x * 7 + y * 13) % 9) - 4));
    data[o + 1] = Math.min(255, Math.max(0, c[1] + ((x * 5 + y * 11) % 9) - 4));
    data[o + 2] = Math.min(255, Math.max(0, c[2] + ((x * 3 + y * 17) % 9) - 4));
    data[o + 3] = 255;
  }
}
// transparent pixel at (0,0)
data[3] = 0;

console.log("quantization:");
const palette = autoPalette(collectPixels(data), 4);
check(palette.length === 4, `autoPalette returns 4 colors (got ${palette.length})`);
check(
  palette.every((p) => p.every((v) => v >= 0 && v <= 255)),
  "palette values in 0..255"
);
console.log("  palette:", palette.map(rgbToHex).join(", "));

// every true cluster color must have a close palette match
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
check(
  Array.from(grid.slice(1)).every((g) => g < 4),
  "all other pixels map to a palette index"
);

// pixels should be classified to the cluster they were generated from
let misclassified = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (x === 0 && y === 0) continue;
    const o = (y * W + x) * 4;
    const want = nearestColorIndex(data[o], data[o + 1], data[o + 2], targets);
    const got = palette[grid[y * W + x]];
    const wantP = targets[want];
    const d =
      Math.abs(wantP[0] - got[0]) +
      Math.abs(wantP[1] - got[1]) +
      Math.abs(wantP[2] - got[2]);
    if (d > 40) misclassified++;
  }
}
check(
  misclassified === 0,
  `all pixels classified to their source cluster (${misclassified} wrong)`
);

console.log("mesh generation:");
const rectsPerColor = palette.map((_, i) => buildRectsForColor(grid, W, H, i));
for (let i = 0; i < 4; i++) {
  console.log(
    `  color ${i} ${rgbToHex(palette[i])}: ${rectsPerColor[i].length} rect(s):`,
    rectsPerColor[i].map((r) => `[${r.x0},${r.y0}..${r.x1},${r.y1}]`).join(" ")
  );
}
// The quadrant with the transparent pixel is an L-shape -> 2 rects;
// the other three solid quadrants merge into exactly 1 rect each.
const rectCounts = rectsPerColor.map((rs) => rs.length).sort();
check(
  rectCounts.join(",") === "1,1,1,2",
  `rect counts are 1,1,1,2 (got ${rectCounts.join(",")})`
);

const pixelSize = 40 / W; // 40mm wide plate
const depth = 5;
const parts = palette.map((color, i) => {
  const boxes = rectsToBoxes(rectsPerColor[i], H, pixelSize);
  return { name: `Color ${i + 1}`, color, positions: meshPositions(boxes, depth) };
});

for (const p of parts) {
  check(p.positions.length % 9 === 0, `part "${p.name}" positions multiple of 9`);
}
const totalTris = parts.reduce((s, p) => s + p.positions.length / 9, 0);
check(totalTris === 5 * 12, `5 boxes total -> 60 triangles (got ${totalTris})`);

// geometry sanity: all z within [0, depth]
const zs = parts.flatMap((p) => p.positions.filter((_, i) => i % 3 === 2));
check(
  zs.every((z) => z >= 0 && z <= depth),
  "all z coordinates within [0, depth]"
);

console.log("STL:");
// use a solid single-box part for the STL byte-size check
const single = parts.find((p) => p.positions.length === 108)!;
const stl = buildSTL(single.positions);
check(stl.byteLength === 84 + 12 * 50, `binary STL size correct (${stl.byteLength})`);
const dv = new DataView(stl);
check(dv.getUint32(80, true) === 12, "STL triangle count = 12");

console.log("3MF:");
async function main() {
  const blob = await build3MF(parts);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  check(names.includes("[Content_Types].xml"), "3MF contains [Content_Types].xml");
  check(names.includes("_rels/.rels"), "3MF contains _rels/.rels");
  check(names.includes("3D/3dmodel.model"), "3MF contains 3D/3dmodel.model");
  const model = await zip.file("3D/3dmodel.model")!.async("string");
  check((model.match(/<object /g) || []).length === 4, "3MF has 4 objects");
  check((model.match(/<item /g) || []).length === 4, "3MF build has 4 items");
  check((model.match(/<base /g) || []).length === 4, "3MF has 4 basematerials");
  check(model.includes('unit="millimeter"'), "3MF units are millimetres");
  check(/displaycolor="#[0-9A-F]{8}"/.test(model), "3MF colors are #RRGGBBAA");
  const triCount = (model.match(/<triangle /g) || []).length;
  check(triCount === 5 * 12, `3MF triangle count = ${triCount} (expect 60)`);

  console.log("STL zip:");
  const zipBlob = await buildSTLZip(parts);
  const szip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  check(
    Object.keys(szip.files).filter((n) => n.endsWith(".stl")).length === 4,
    "zip contains 4 STL files"
  );

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
