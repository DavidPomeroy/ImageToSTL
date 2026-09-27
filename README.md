# Image → Multi-Color 3D Print

A small Next.js web app that turns any uploaded image into a **3D-printable
plate** (default **5 mm thick**) — as a flat multi-color mosaic (2–16 filaments),
a HueForge-style layered relief (2–16 filaments), a single-filament lithophane, or a
full-color **CMYK lithophane** (Cyan / Magenta / Yellow / White filaments).

Everything runs **client-side in the browser**: no server, no uploads.

## How it works

1. **Upload** a PNG / JPG / WebP. Transparent pixels become empty space
   (cut-outs), so logos on transparency work nicely.
2. **Downscale** — the image is reduced to a printable pixel grid
   (adjustable, default 120 px on the longest side). No dithering: dither
   dots are too small to print.
3. **Quantize colors** — median-cut + farthest-point seeded k-means
   (`lib/quantize.ts`). For mosaic and layered modes, you can choose the
   number of colors (2–16 filaments, default 4). You can click any swatch to
   match the palette to your actual filaments; pixels are re-assigned to the
   nearest color.
4. **Mesh generation** — each color part becomes a manifold heightfield:
   top/bottom sheets per cell plus side faces only where the solid ends or
   the Z range changes (`lib/mesh.ts`), so every mesh edge is shared by
   exactly two triangles. In lithophane mode, pixels are grouped by
   layer-snapped thickness and each level is extruded to its own height.
   With a shape selected, the mesh is clipped to the exact silhouette so the
   outline is smooth rather than pixel-stepped (see *Smooth shape edges*).
5. **Export** (`lib/exporters.ts`):
   - **3MF** — one file containing the individual parts (one per color) with a
     `m:colorgroup` (3MF materials extension) carrying the filament colors.
     Bambu Studio parses the colorgroup and auto-assigns each part to its
     own extruder (1–N). In PrusaSlicer, import as *one object with multiple
     parts* and assign extruders.
   - **STL zip** — one binary STL per color, all sharing the same origin, for
     slicers that prefer separate STLs.

## Print modes

**Mosaic (flat, uniform thickness)** — each color region is a solid prism the
full plate thickness, side by side in the XY plane. Multi-material print
(2–16 filaments, e.g. AMS / MMU).

**Layered (HueForge-style relief)** — the filaments (2–16, default 4) are stacked
in Z: Filament 1 (darkest) at the bottom, through to the lightest filament at
the top. Each pixel's column stops at the top of its own color's band, so the
visible top face of every pixel is printed in its assigned color and the plate
becomes a variable-height relief. Band boundaries snap to whole multiples of the
chosen print layer height, and the app shows you exactly where to swap
filaments ("swap at z = 1.2, 2.6, 3.8 mm · layers 7, 13, 20"), mirroring
HueForge's swap instructions. Slice with the same layer height you selected
in the app.

**Choosing more than four colors** — the *Number of colors* slider (2–16,
default 4) appears in Mosaic and Layered mode only: Lithophane is
single-filament and CMYK is always four. In the two palette modes the count is
free — the 3MF carries one part, and one extruder assignment, per color — so
5+ colors print on a toolchanger or with several AMS/MMU units chained. On a
printer with fewer slots than colors, note the difference between the modes:

- **Mosaic** needs every color present in the same XY plane, so all N filaments
  must be loaded at once (a mid-print swap would leave gaps).
- **Layered** only swaps (N − 1) times as the plate builds up, so extra colors
  can be fed by swapping spools by hand at the swap heights the app lists.

**Lithophane (backlit, single filament)** — thickness encodes brightness
(each mode below has a *Surface: Pixelated / Smoothed* toggle — smoothed
bilinearly interpolates relief heights between pixel centers, giving
commercial-lithophane-style surfaces instead of blocky steps):
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

Every slider in the sidebar doubles as a text field: click a value, type an
exact one and press Enter (or click away) to apply it. The entry is clamped to
the slider's range and snapped to its step, a unit suffix is ignored (`12 mm`
works as well as `12`), and Esc reverts. Dragging the slider handle still works
as before, and the two stay in sync.

## Tests

```bash
npx tsx scripts/test-core.ts
```

Covers quantization quality (k-means must recover 4 known clusters), rect
merging, geometry bounds, wall orientation (outward-facing walls, signed volume
against the fine-cell reference, directed-edge consistency), binary STL layout,
and 3MF zip/XML structure. It also walks every picker shape: the outline must be
a simple polygon (no crossing or doubled-back edges) and must enclose no
background pixels — an arc swept the wrong way folds back through the shape's
interior and the even-odd fill carves it out as a hole, which is exactly the
class of bug this check exists to catch. The slider text-entry rules are
covered too: a typed value is clamped to the slider's range, snapped to its
own step grid (the maximum stays reachable), and the display → parse round
trip is exercised for every value on every slider, so editing one field can
never silently move a setting.

## Project layout

```
app/               Next.js app router page, layout, styles
components/        Dropzone, Controls, PaletteEditor, Preview2D, Preview3D
lib/quantize.ts    median cut + farthest-point seeded k-means, pixel mapping
lib/mesh.ts        pixel grid → merged rects → extruded box triangles
                   (arbitrary z0..z1 bands for layered mode)
lib/exporters.ts   binary STL writer, multi-part 3MF (JSZip) writer
lib/pipeline.ts    downscale + orchestration glue
lib/shapes.ts      shape outlines (unit-space polygons), silhouette, classifier
lib/slider.ts      slider text entry: parse, format, clamp and step-snap rules
lib/curve.ts       plate bend around a vertical axis (flat → full cylinder)
scripts/           core-logic test
```

## Bambu Studio notes

- Meshes are manifold (boundary-only heightfield meshing) — no non-manifold
  repair prompts.
- On import, the 3MF loads as a **single object with multiple parts** (one
  assembly object referencing one mesh object per color), so the parts stay
  aligned and each takes one extruder. Bambu Studio shows its standard
  color-mapping dialog (the same one used for colored OBJ/3MF imports): it
  lists the part colors and lets you confirm the filament mapping — click OK
  and each part lands on its own extruder. Parts also carry per-part extruder
  metadata (`Metadata/model_settings.config`) so the assignment is pre-set.
- Bambu Studio deliberately ignores project settings
  (`Metadata/project_settings.config`) in files it did not create, so the
  filament colors come from the color-mapping dialog / your own filament
  choices.

## Shapes & borders

Besides the full-rectangle plate (**Full**) and a free **Custom** crop, the
print can take one of **29 outline shapes**: square, circle, heart, star,
diamond, cross, triangle, hexagon, Christmas tree, snowflake, stocking, bell,
gingerbread man, gingerbread woman, pumpkin, ghost, bat, leaf, acorn, egg,
bunny, flower, tulip, butterfly, shamrock, sun, shell, starfish and moon.
They are grouped in the picker's collection dropdown — **Standard**,
**Christmas**, **Halloween**, **Autumn**, **Easter**, **Spring**, **Summer**
and **Occasions** — and choosing a collection selects its first shape straight
away (Full and Custom sit above the dropdown and are always available). Click
or drag on the processed preview to position the shape, and scale it as a
percentage of the plate. Pixels outside the shape become empty space, exactly
like transparency.

The seasonal outlines are built from sampled arcs and béziers so every corner
is round, and each one is checked by the test suite to be a *simple* polygon
(no self-crossing or doubled-back edges) that encloses no background — a
self-intersecting outline would be carved out by the even-odd fill as a hole.

A **border** (0–5 mm) can be added to any shape (the full rectangle gets a
frame around the image). Border rendering per mode:
- Mosaic / Layered: Filament 1 (darkest auto-detected colour)
- Lithophane: maximum thickness (darkest backlit)
- CMYK: solid dark (full CMY + max white)

The border ring is not rasterised per pixel: it is classified per fine cell
against the true distance to the shape boundary, so it reaches exactly out
to the smooth silhouette (no ragged band of interior treatment short of the
edge) and its inner edge is snapped onto the shape's inward offset — exactly
as smooth as the outline itself.

### Smooth shape edges

The shape outline is not rasterised: the pixel grid is refined 2-4x along the
shape boundary and boundary vertices are snapped onto the **exact analytic
silhouette** (nearest point on the polygon/curve). Straight edges come out
perfectly straight and circular/curved edges follow the true curve instead of
a blocky pixel staircase — the mesh never protrudes past the true outline
(worst case a small under-shoot where the boundary runs tangentially to the
grid). Every part clips to the same silhouette, so multi-colour plates still
tile with no gaps or overlaps.

Meshes stay manifold — diagonal pinch points (thin diagonal connections) and
near-coincident layers are repaired by sub-pixel nudges, invisible at print
scale. Bambu Studio refuses meshes with 4-way point-contact edges instead of
silently repairing them, so the diagonal-contact repair fills such contacts
whenever it can do so without inventing material: from the cell's own pixel,
or — for silhouette-corner slivers — from the diagonal partner that already
carries the part. A contact is only ever cleared when another part of the
plate covers the cleared cell, so the repair can never punch a hole in the
combined plate along the outline. The test suite sweeps randomised noise
images across every mode, shape, size and curvature — plus a border-ring
suite that verifies the ring reaches the silhouette, owns exactly the
border part(s) per mode, and follows the shape's inward offset — to keep
those guarantees.

Every side wall is also emitted **outward-facing**, so a shaped plate is not
merely watertight but positively oriented: summing the divergence over a part's
triangles returns the volume of the material that part carries (the suite
compares the clipped square's signed volume against the fine-cell reference
exactly, and asserts every directed mesh edge has an opposite twin). That
matters on screen as much as in the slicer — a back-facing wall is culled by
single-sided renderers (which reads as a gap along that outline edge) and an
inside-out part is what makes a slicer flag the file.

Uniform areas of the top/bottom sheets are emitted as merged runs instead of
per-fine-cell quads (with per-column break sets — unioned over every row *and*
mirrored against every side-wall vertex, so a merged face can never skip a
vertex that a silhouette or z-step wall uses, and no T-junction edges are
left), which typically cuts the triangle count of large plates
several-fold while keeping full fine resolution along the silhouette, the
border ring's contour and every relief step.

At the outline, the wall shows one colour column per boundary pixel — and a
single colour column is only about one extrusion wide, so where the image is
dithered the edge used to come out as a barcode of sub-millimetre stripes
(which slicers cannot reproduce faithfully and which reads as a shattered
edge). Runs of the outline shorter than a printable length are now absorbed
into the neighbouring run, so dithered art prints a solid edge; a pixel keeps
its exact colour wherever its colour really spans a printable stretch of the
outline, and interior pixels are never touched.


## Curvature

The flat plate can be bent around a vertical (image-height) axis, from flat
(0°) to a **full cylinder (360°)** — the classic curved lithophane / lamp
shade. The plate width becomes the inner surface's arc length (bend radius
shown in the stats when curved) and the image faces outward.

The bent plate **stands on its bottom edge**: the image's height becomes the
print's Z axis, so the bottom row of the image becomes a flat ring/arc lying
on the bed and the object rests on real contact area from the first layer up
(no "floating regions" in the slicer). The solid is re-seated on the bed
automatically, at any curvature and for every shape. Full 360° is clamped internally to
359.5° so the seam edges never coincide — the tiny gap prints cleanly and is
handy for lamp fittings. Works with every mode, shape and border, and with
both pixelated and smoothed surfaces.

## Tips for printing

- Keep the pixel size ≥ your nozzle diameter (the app warns below 0.4 mm):
  lower the resolution or increase the plate width.
- 5 mm at 0.2 mm layer height = 25 layers; every color prints on every
  layer, so expect plenty of filament swaps — that's normal for a mosaic.
- In layered mode there are only (N - 1) filament swaps total (at the band
  boundaries, e.g. 3 swaps for 4 colors), but note the plate height varies per
  pixel — darkest color regions are the thinnest.
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
