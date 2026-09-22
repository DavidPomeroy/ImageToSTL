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

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
