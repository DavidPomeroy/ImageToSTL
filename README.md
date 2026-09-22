# Image → 4-Color 3D Print

A small Next.js web app that turns any uploaded image into a **3D-printable
plate** (default **5 mm thick**) — as a flat 4-color multi-material mosaic,
a HueForge-style layered relief, a single-filament lithophane, or a
full-color **CMYK lithophane** (Cyan / Magenta / Yellow / White filaments).

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
   each extruded into a box prism over its Z band (`lib/mesh.ts`). In
   lithophane mode, pixels are grouped by layer-snapped thickness and each
   level is extruded to its own height. Rect merging keeps triangle counts
   far below one-box-per-pixel.
5. **Export** (`lib/exporters.ts`):
   - **3MF** — one file containing 4 parts (one per color) with a
     `m:colorgroup` (3MF materials extension) carrying the filament colors.
     Bambu Studio parses the colorgroup and auto-assigns each part to its
     own extruder (1–4). In PrusaSlicer, import as *one object with multiple
     parts* and assign extruders.
   - **STL zip** — one binary STL per color, all sharing the same origin, for
     slicers that prefer separate STLs.

## Print modes

**Mosaic (flat, uniform thickness)** — each color region is a solid prism the
full plate thickness, side by side in the XY plane. Classic 4-filament
multi-material print (AMS/MMU).

**Layered (HueForge-style relief)** — the 4 filaments are stacked in Z:
Filament 1 (darkest) at the bottom, Filament 4 at the top. Each pixel's
column stops at the top of its own color's band, so the visible top face of
every pixel is printed in its assigned color and the plate becomes a
variable-height relief. Band boundaries snap to whole multiples of the
chosen print layer height, and the app shows you exactly where to swap
filaments ("swap at z = 1.2, 2.6, 3.8 mm · layers 7, 13, 20"), mirroring
HueForge's swap instructions. Slice with the same layer height you selected
in the app.

**Lithophane (backlit, single filament)** — thickness encodes brightness:
dark pixels print thick, bright pixels thin (adjustable min/max, e.g.
0.8–5 mm). Every thickness step snaps to a whole print layer. Export is a
single part (3MF or STL). Print flat with the relief side up in white or
natural PLA, high infill, then hold it in front of a light.

**CMYK lithophane (backlit color, 4 filaments)** — thin Cyan / Magenta /
Yellow layers at the bottom mix subtractively to form each pixel's color
(more of a channel = more of its complement absorbed), and a white
lithophane relief on top controls brightness. Everything snaps to whole
print layers: set your slicer layer height, tune "layers per color channel"
(color strength) and the white min/max (brightness range). Exports as 4
parts in print order — Cyan (bottom), Magenta, Yellow, White (top) — in one
3MF, or as 4 STLs. Assign each part its filament in the slicer; an AMS/MMU
handles the swaps automatically.

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
                   (arbitrary z0..z1 bands for layered mode)
lib/exporters.ts   binary STL writer, multi-part 3MF (JSZip) writer
lib/pipeline.ts    downscale + orchestration glue
scripts/           core-logic test
```

## Bambu Studio note

Opening any 3MF not saved by Bambu Studio may show a notification like *"The
3mf file has invalid config, load geometry data only"* (or *"not from Bambu
Lab…"* on newer versions). This is cosmetic — the geometry loads normally.

The exported 3MF embeds Bambu-style metadata
(`Metadata/model_settings.config` + `Metadata/project_settings.config`)
alongside the standard 3MF `m:colorgroup`: parts come pre-assigned to
extruders 1–4, and when the file is opened as a project the filament section
is pre-populated with the four colors (PLA).

## Tips for printing

- Keep the pixel size ≥ your nozzle diameter (the app warns below 0.4 mm):
  lower the resolution or increase the plate width.
- 5 mm at 0.2 mm layer height = 25 layers; every color prints on every
  layer, so expect plenty of filament swaps — that's normal for a mosaic.
- In layered mode there are only 3 filament swaps total (at the band
  boundaries), but note the plate height varies per pixel — darkest color
  regions are the thinnest.
- For truer HueForge color blending, pick filaments by their Transmission
  Distance (TD) and order the stack dark → light (the auto-detected palette
  is already sorted that way).
- Lithophanes: white/natural PLA works best; more perimeters or 100% infill
  gives the most even light diffusion. Higher pixel resolution = finer
  detail (and bigger files).
- CMYK lithophanes: use translucent C/M/Y filaments and a plain white for
  the relief. More color layers per channel = stronger color but a taller,
  slower print. Colors will be less saturated than on screen — that's the
  physics of subtractive filament mixing.
