# Image → 4-Color 3D Print

A small Next.js web app that turns any uploaded image into a **flat, 4-color,
3D-printable plate** (default **5 mm thick**) — ready for multi-material FDM
printers (Bambu Lab AMS, Prusa MMU, toolchangers, …).

Everything runs **client-side in the browser**: no server, no uploads.

## How it works

1. **Upload** a PNG / JPG / WebP. Transparent pixels become empty space
   (cut-outs), so logos on transparency work nicely.
2. **Downscale** — the image is reduced to a printable pixel grid
   (adjustable, default 120 px on the longest side). No dithering: dither
   dots are too small to print.
3. **Quantize to 4 colors** — median-cut + farthest-point seeded k-means
   (`lib/quantize.ts`). You can click any swatch to match the palette to
   your actual filaments; pixels are re-assigned to the nearest color.
4. **Mesh generation** — same-color pixel runs are merged into rectangles,
   each extruded into a box prism from z = 0 to the chosen depth
   (`lib/mesh.ts`). This keeps triangle counts far below one-box-per-pixel.
5. **Export** (`lib/exporters.ts`):
   - **3MF** — one file containing 4 parts (one per color) with
     `basematerials` display colors. Open in Bambu Studio / PrusaSlicer,
     import as *one object with multiple parts*, assign an extruder per part.
   - **STL zip** — one binary STL per color, all sharing the same origin, for
     slicers that prefer separate STLs.

The model is a flat mosaic: each color region is a solid prism the full
plate thickness, sitting side by side in the XY plane.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

## Tests

```bash
npx tsx scripts/test-core.ts
```

Covers quantization quality (k-means must recover 4 known clusters), rect
merging, geometry bounds, binary STL layout, and 3MF zip/XML structure.

## Project layout

```
app/               Next.js app router page, layout, styles
components/        Dropzone, Controls, PaletteEditor, Preview2D, Preview3D
lib/quantize.ts    median cut + farthest-point seeded k-means, pixel mapping
lib/mesh.ts        pixel grid → merged rects → extruded box triangles
lib/exporters.ts   binary STL writer, multi-part 3MF (JSZip) writer
lib/pipeline.ts    downscale + orchestration glue
scripts/           core-logic test
```

## Tips for printing

- Keep the pixel size ≥ your nozzle diameter (the app warns below 0.4 mm):
  lower the resolution or increase the plate width.
- 5 mm at 0.2 mm layer height = 25 layers; every color prints on every
  layer, so expect plenty of filament swaps — that's normal for a mosaic.
