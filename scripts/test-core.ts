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
import {
  computeCmykStacks,
  meshPartPositions,
  processImageData,
} from "../lib/pipeline";
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
  return { name: `Color ${i + 1}`, color, positions: meshPositions(boxes, 0, depth) };
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

console.log("layered (HueForge-style) mode:");
const fakeImageData = { data, width: W, height: H } as unknown as ImageData;
const layered = processImageData(fakeImageData, palette, 40, 5, "layered", 0.2);

check(layered.bands.length === 4, `4 color bands (got ${layered.bands.length})`);
const expectedTops = [1.2, 2.6, 3.8, 5.0];
check(
  layered.bands.every((b, i) => Math.abs(b.z1 - expectedTops[i]) < 1e-6),
  `band tops snap to layers [${layered.bands.map((b) => b.z1.toFixed(2)).join(", ")}] (expect 1.20, 2.60, 3.80, 5.00)`
);
check(Math.abs(layered.depthMm - 5) < 1e-6, "effective depth = 5 mm");

// band coverage must nest: band k covers pixels with palette index >= k
const pxArea = layered.pixelSizeMm ** 2;
const bandAreas = layered.meshes.map(
  (m) => m.boxes.reduce((sum, b) => sum + b.w * b.h, 0) / pxArea
);
check(
  bandAreas.join(",") === "63,47,32,16",
  `band pixel coverage nests 63,47,32,16 (got ${bandAreas.join(",")})`
);

for (let i = 0; i < 4; i++) {
  const m = layered.meshes[i];
  const wantZ0 = i === 0 ? 0 : layered.bands[i - 1].z1;
  check(
    Math.abs(m.z0 - wantZ0) < 1e-9 && Math.abs(m.z1 - layered.bands[i].z1) < 1e-9,
    `band ${i} z-range ${m.z0.toFixed(2)}-${m.z1.toFixed(2)} mm`
  );
}

const lpos = meshPartPositions(layered);
const lzs = lpos.flatMap((pt) => pt.positions.filter((_, i) => i % 3 === 2));
check(
  lzs.every((z) => z >= 0 && z <= 5 + 1e-6),
  "layered mesh z within [0, 5]"
);
check(
  lpos.every((pt) => pt.positions.length > 0),
  "all 4 layered parts non-empty"
);

console.log("mosaic mode (via pipeline):");
const mosaic = processImageData(fakeImageData, palette, 40, 5, "mosaic");
check(
  mosaic.meshes.every((m) => m.z0 === 0 && m.z1 === 5),
  "mosaic bands all span 0-5 mm"
);
const mosaicAreas = mosaic.meshes.map(
  (m) => m.boxes.reduce((sum, b) => sum + b.w * b.h, 0) / mosaic.pixelSizeMm ** 2
);
check(
  mosaicAreas.join(",") === "16,15,16,16",
  `mosaic per-color coverage 16,15,16,16 (got ${mosaicAreas.join(",")})`
);

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
check(Math.abs(litho.depthMm - 4) < 1e-4, "effective depth = 4 mm");
const lithoBoxCount = litho.meshes[0].boxCount ?? 0;
check(
  lithoBoxCount > 0 && lithoBoxCount <= 16,
  `column-uniform heights merge into <= 16 boxes (got ${lithoBoxCount})`
);
const lithoPositions = litho.meshes[0].positions!;
check(
  lithoPositions.length > 0 && lithoPositions.length % 9 === 0,
  "lithophane positions valid"
);
const lithoZs = lithoPositions.filter((_, i) => i % 3 === 2);
check(
  lithoZs.every((z) => z >= 0 && z <= 4 + 1e-4),
  "lithophane z within [0, 4]"
);

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
  stacks.c[3] === 2 && stacks.m[3] === 2 && stacks.y[3] === 2,
  "gray pixel: equal mid color layers"
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
const prev = cmykProc.cmykPreview!;
check(
  prev[0] > prev[4],
  `backlit preview: white pixel brighter than black (${prev[0]} vs ${prev[4]})`
);
check(prev[19] === 0, "transparent pixel has alpha 0 in preview");
const cmykPos = meshPartPositions(cmykProc);
const cmykZs = cmykPos.flatMap((pt) => pt.positions.filter((_, i) => i % 3 === 2));
check(
  cmykZs.every((z) => z >= -1e-9 && z <= 4.4 + 1e-4),
  "CMYK z within [0, 4.4]"
);

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
  check(model.includes('unit="millimeter"'), "3MF units are millimetres");
  check(/<m:color color="#[0-9A-F]{8}"/.test(model), "3MF colors are #RRGGBBAA");
  const triCount = (model.match(/<triangle /g) || []).length;
  check(triCount === 5 * 12, `3MF triangle count = ${triCount} (expect 60)`);

  const layeredBlob = await build3MF(meshPartPositions(layered));
  const lzip = await JSZip.loadAsync(await layeredBlob.arrayBuffer());
  const lmodel = await lzip.file("3D/3dmodel.model")!.async("string");
  check(
    (lmodel.match(/<object /g) || []).length === 4,
    "layered 3MF has 4 objects"
  );

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
  const lithoStl = buildSTL(lithoPositions);
  check(
    lithoStl.byteLength === 84 + (lithoPositions.length / 9) * 50,
    "lithophane STL size matches triangle count"
  );

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
