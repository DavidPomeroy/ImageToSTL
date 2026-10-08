# Image → Multi-Color 3D Print

A small Next.js web app with eight tools that all export slicer-ready, multi-part 3MF / STL:

- **Image → 3D** (`/`) — turns any uploaded image into a **3D-printable plate**
  (default **5 mm thick**): a flat multi-color mosaic (2–16 filaments), a
  HueForge-style layered relief, a single-filament lithophane, or a full-color
  **CMYK lithophane** (Cyan / Magenta / Yellow / White filaments).
- **Text → 3D** (`/text`) — turns a line of text into a freestanding
  **two-colour name sign**: a background-colour rim with a raised
  foreground-colour inner section.
- **Badge → 3D** (`/badge`) — a shaped **name badge / keychain**: raised or
  engraved text on a plate with an optional keyring hole.
- **Coaster → 3D** (`/coaster`) — an image on a round / hex / octagon / square
  **coaster** with a raised rim (flat multi-colour mosaic or a single-filament
  relief).
- **Frame → 3D** (`/frame`) — a **picture frame** for a plate from the Image → 3D
  tool: it follows the plate's outline (full rectangle or a standard shape, flat
  or curved), the plate drops into a rebate, and a cavity behind it holds an
  **LED strip or board** (open back, or a back panel with a wire hole / LED
  channel).
- **Box → 3D** (`/box`) — a **storage box** whose lid is a plate from the
  Image → 3D tool: it follows the plate's outline, and a separate lid (a plug
  that fits the opening, with a recess the plate drops into) is printed beside
  it, so the plate becomes the box lid.
- **Drawers → 3D** (`/drawers`) — a freestanding **chest of drawers**: an
  open-front cabinet divided into 1–8 compartments, plus matching drawer trays
  printed beside it. Tune the cabinet size, wall/shelf thickness and drawer fit.
- **Terrain → 3D** (`/terrain`) **[experimental — may not work as expected]** — turns a heightmap image **or a place picked on
  a map** into a solid **3D terrain tile** with a variable-height relief, an
  optional coloured base plate and optional elevation colour bands.

Everything runs **client-side in the browser**: no server and no image uploads.
Terrain is the only tool that touches the network — it fetches map and elevation
tiles for the location you choose (nothing else leaves your device).

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

**Mosaic (flat plate, base + thin color skin)** — the plate prints as a solid
base slab in its own filament color with a thin per-color skin on top (side by
side in the XY plane). The *Top color thickness* slider sets the skin height
(default 0.8 mm, snapped to whole print layers); the base takes the remaining
height. The top thickness can never exceed the plate thickness; set it equal
to the plate thickness and the skin covers the full height — full-height color
columns with no base slab (one fewer filament). Multi-material print (2–16
colors plus the base, e.g. AMS / MMU).

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

## Text → 3D sign (`/text`)

The second page makes a freestanding two-colour name sign from a line of text:
a **background-coloured rim** with a **raised foreground-coloured inner
section**. Two parts, one extruder each, exported as one 3MF (or an STL zip).

**Controls** — text (newlines make multiple lines), font (Inter, Arial Black,
Georgia, Pacifico, Lobster, Anton, Bebas Neue, or an uploaded font file),
bold/italic, background + raised colours, then:

| Control | Range | Meaning |
| --- | --- | --- |
| Object width | 40–300 mm | Total sign width *including* the outline; the font size is fitted to it |
| Outline width (rim) | 0–6 mm | Dilation radius around the glyph — the visible rim |
| Inner inset | 0–4 mm | Erosion radius inside the glyph — sets the raised stroke width |
| Outline height | 1–10 mm | Height of the background part |
| Raised text extra height | 0.4–5 mm | How much the inner section stands above the rim |
| First letter size | 1–2.5× | Drop cap on the first character of the first line |

**There is no letter-spacing control** — spacing is decided entirely by the
code, because the only spacing that matters is the one that keeps the sign
printable. See *Automatic letter spacing* below.

### Uniform line weight, even with a drop cap

A first letter drawn at 2× is naturally ~2× the stroke width of the rest of
the text, which would give the rim a fat border and the raised section a fat
stroke around just that one letter. The glyph is therefore **stroke-
compensated at raster time**: the app estimates the normal half-stroke width
`Hn` (the 90th percentile of inward depths across the non-drop-cap glyphs) and
erodes the enlarged glyph's ink by `(s − 1)·Hn`, shrinking its strokes to match
the others. The drop cap keeps its size, position and silhouette — only its
stroke weight is normalised. Because the *glyph* is uniform, both downstream
operations use a single radius everywhere: one dilation for the rim, one
erosion for the raised section.

### Automatic letter spacing (one connected background)

The sign is a single object: the rim of neighbouring letters must touch, or
the slicer sees a pile of separate islands. Spacing is solved per gap rather
than exposed as a slider:

1. **Inner text first.** The drop cap is compensated before layout, so the
   measured ink is exactly the ink that gets drawn.
2. **Per-letter border.** Each letter is rasterised on its own and its ink is
   recorded **row by row** (canvas advance metrics alone miss italic overhang
   and script swashes). The gap between two neighbours is then measured only
   on the rows where *both* letters actually have ink — a bounding-box gap
   underestimates the visible gap badly when a swash sits far below a
   lower-case body, and that is what used to leave islands. The right-hand
   letter is slid left until the true gap is at most `2·outline − 1.5 px`.
3. **Verify on the real geometry.** A second pass rasterises each letter at
   its final position, dilates each by the outline radius, and labels the
   union; while more than one component survives, the measured
   background-to-background gap is closed by shifting that letter (and the
   ones after it) left. Repeat until the rim is one piece.

Every step is **tighten-only** and keeps at least a pixel of ink clearance, so
letters are never overlapped — they meet through the rim. Gaps differ per
pair: wide pairs (an `R` next to a `u`) get pulled in more than naturally
tight ones, which keeps their own spacing. Line gaps are capped the same way so
multi-line text joins too. If something genuinely cannot be joined (an `i`
dot with no shared rows), the app says so in a warning rather than silently
drawing a bridge.

### Smooth sign edges

Sign parts are not meshed as pixel staircases. `lib/smoothExtrude.ts` samples
the mask into a **sub-pixel coverage field**, runs **marching squares at level
0.5** with linear interpolation (so edges land between pixels), simplifies
with Ramer–Douglas–Peucker and applies closed **Chaikin** smoothing, then fills
the caps with an even-odd scanline pass (which handles the counters in `e`,
`o`, `a` as real holes) and builds outward-facing side walls between the
shared z-levels of the two parts. Loops are oriented by nesting depth — outer
counter-clockwise, holes clockwise — so wall normals point out of the
material, and cap/wall edges are shared, keeping the parts manifold for the
slicer.

## Badge → 3D keychain (`/badge`)

A shaped **name badge / keychain** with raised or engraved text on a plate and
an optional keyring hole. Raised mode is two colours (plate + raised text);
engraved mode recesses the text into the plate and prints in one filament.
Exported as one 3MF or an STL zip.

- **Shape** — rounded rectangle, rectangle, circle, dog tag, hexagon, heart or
  star.
- **Text** — up to a few lines (Enter for a new line), any built-in font or an
  uploaded TTF/OTF, bold / italic. The font is auto-fitted inside the shape's
  margin, with a size multiplier.
- **Keyring hole** — a punched hole (diameter + a gap from the shape's edge). It
  sits at the top centre — except on a wide **dog tag**, where it moves to the
  left end and the text shifts right to clear it. On shapes whose top is concave
  or pointy (**heart**, **star**) the hole is placed at the highest spot inside
  the material where it fits, so it never lands in the notch or the point.
- **Text style** — **raised** extrudes the text on top (plate + text parts, two
  colours); **engraved** carves it into the plate (single plate-colour part,
  engrave depth leaves ≥ 0.4 mm of floor).

Both modes are extruded on a **fine pixel grid** (0.12 mm) with the shared
manifold heightfield mesher, so the stepped edges stay below the nozzle size and
slicers never ask to repair the mesh. Raised: print the plate in the plate
colour and swap (or use a second extruder) for the text. Engraved: single
filament, slice with the engraved side up.

## Coaster → 3D (`/coaster`)

An uploaded image becomes a **coaster** with a raised rim. Two modes:

- **Mosaic** (multi-colour) — a solid shaped base in the rim colour, with the
  quantized image raised on top inside the rim (one extruder per colour). The
  palette is auto-detected and editable.
- **Relief** (single filament) — a raised rim with the image engraved in the
  well (bright = high, or invert it). The engraved heights snap to a limited
  number of steps, like the terrain's layer snapping: the heightfield mesher
  splits every wall at every distinct height in the part, so a continuous
  per-pixel relief balloons into millions of triangles and stalls the preview.

- **Shape** — circle, hexagon, octagon, rounded square or square.
- **Controls** — size (width), base thickness, rim width, colour height / relief
  depth, resolution (up to 400 px, so the shaped edge stays below the nozzle),
  and — for mosaic — the number of colours.

Like the badge, every part is manifold. Export as one 3MF (base + one part per
colour) or an STL zip.

## Frame → 3D (`/frame`)

A **picture frame** for a plate made on the Image → 3D page — sized so the plate
drops straight in. The frame follows the plate's outline: the **full rectangle**
and the **standard shapes** (square, triangle, hexagon, circle, heart, star,
diamond, cross).

Enter the plate's settings (width, height, thickness and — for a standard shape
— the shape size) plus the frame geometry. Or press **Copy settings to
Frame → 3D** on the Image → 3D page: it carries the plate's outline, size,
thickness and curvature over and opens this tool pre-filled. (Shapes the frame
cannot build — Custom and the seasonal categories — fall back to the full
rectangle.)

- **Rebate only** — the plate sits in a recess and is held by friction or tape
  (no overhangs). This is the default.
- **Front lip (slide-in)** — a rim that holds the plate's front edge. A closed
  ring would trap a rigid plate, so the lip is **open across the plate's top
  edge**: the plate drops in from the top, tucks behind the side/bottom lip and
  rests on the ledge (keep that edge up). An optional **top-stop tab** is a thin
  centred snap fit over the opening (leave it off for thick/rigid plates). The
  lip overhangs, so bridge/support it or print the frame front-down; it is a
  second part in the same colour.
- **Air gap** — a cavity behind the plate sized for an **LED strip or board**
  (8–15&nbsp;mm suits most). The back is either **open** (rear access), a
  **solid panel** with a bored **wire hole**, or a panel with an **LED channel**
  groove just inside the ledge.
- **Curvature** — match the Image → 3D *Curvature* setting and the frame bends
  around the same axis (a partial arc up to a full lamp-shade cylinder), so its
  rebate follows the curved plate. The side border is capped automatically so a
  near-360° frame never wraps past a full turn and overlaps itself.

The frame body is a single manifold heightfield — the perimeter wall, the rebate
ledge that supports the plate and the cavity floor are one per-cell height above
the bed, so the whole body is one part with no coincident internal faces. The
outline is derived from the plate silhouette with a signed distance field, so the
border width is uniform all round and the rebate follows the true outline
instead of a scaled copy. For a curved frame the mesh is built flat and then bent
with the plate's own transform (`lib/curve.ts`: inner radius `R = width / theta`,
image facing outward), so the rebate lands exactly where the curved plate does.
Exports as one 3MF or STL (two parts when the front lip is on). Shape corners can
leave the same tolerated 4-way "saddle" point contacts as the flat plate —
slicers auto-repair them.

## Box → 3D (`/box`)

A **storage box** whose lid is a plate made on the Image → 3D page. The box
follows the plate's outline — the **full rectangle** and the **standard shapes**
(square, triangle, hexagon, circle, heart, star, diamond, cross) — with a floor
and perimeter walls, and a separate **lid** printed beside it.

Enter the plate's settings (width, height, thickness and — for a standard shape
— the shape size) plus the box geometry. Or press **Copy settings to Box → 3D**
on the Image → 3D page: it carries the plate's outline and size over and opens
this tool pre-filled. (Shapes the box cannot build — Custom and the seasonal
categories — fall back to the full rectangle.)

- **Box depth** — the interior cavity depth, from the floor top to the opening.
- **Wall thickness** — the box walls and floor (a single, uniform thickness).
- **Lid** — *Open box* (no lid), *Separate lid*, *Hinged lid*, or *Hinged lid
  (separate parts)*. The separate lid lands on the box rim (the plate footprint
  is larger than the opening, so it cannot drop in) and carries a **plug** on
  its underside that registers into the opening.
- **Lid overhang / Fit clearance / Plug depth** — how far the plate overhangs
  the opening, the lid-to-box fit gap, and how deep the plug enters.
- **Plug bevel** — the plug's walls are drafted (0–45&nbsp;° from vertical) so the
  plug is full width at the lid and tapers narrower toward its bed end. This
  keeps the walls self-supporting (≤45&nbsp;°) when the lid is printed
  plug-down, so the plug needs no support, and eases it into the opening; the
  top stays full width so it still fits. 0&nbsp;° gives straight vertical walls.
- **Hinged lid** — a **print-in-place pin hinge** runs along the shape's flat
  **top** edge: a round pin (part of the box, along that edge, never wider than
  the box) passes through C-shaped knuckles on the lid with a **hinge
  clearance** (0.2–0.35&nbsp;mm suits most FDM printers); the lid prints
  **standing open at 90°**, in line with the wall, so it is self-supporting.
  Break the hinge free with a gentle wiggle after printing. Outlines with a flat
  top edge (rectangle, square, hexagon, diamond, cross) take the hinge; a
  pointed top (triangle, star, circle, heart) falls back to a separate lid.
  (Planned, later: hinging those on a flat side/bottom edge instead.)
- **Hinged lid (separate parts)** — the same pin-and-knuckle hinge, but the lid
  prints **flat beside the box** (like a separate lid) instead of standing open,
  so it needs **no support**. The box carries the round pin, lifted on a short
  mount just outside its flat top edge; **slide the lid's knuckles onto the pin
  from one end** to assemble — no breaking free, no flex. The wrap keeps the lid
  captive, and it hinges open. Same flat-top-edge rule as the print-in-place
  hinge; pointed tops fall back to a separate lid.

The lid is a **picture-frame-style recess**: the plate drops into a shallow
pocket in the lid's top, so the lid holds it. A separate lid is built from the
same manifold heightfield as the box, then shifted beside it (a 10&nbsp;mm gap)
so the two parts print flat, side by side, in one job — no overlapping geometry,
so the lid lifts off. The print-in-place hinged lid is the same heightfield,
opened 90° about the hinge, with the pin and knuckles added as extra solids (the
pin overlaps the wall, the knuckles overlap the lid, so a slicer unions each to
its leaf while the pin clearance keeps the two free). The separate hinged lid is
that same heightfield printed **flat**, with knuckles added in place; the pin is
lifted onto an L-shaped mount on the box's top edge so both halves still print
flat and slot together. Exports as one 3MF or STL (two parts when the lid is
on); print the plate from the Image → 3D tool separately and seat it in the lid.

## Drawers → 3D (`/drawers`)

A freestanding **chest of drawers** built from a few parameters — no image
needed. The cabinet is an open-front box (floor + left/right/back walls + roof)
divided by (N − 1) shelves into **1–8 compartments**, and **N drawer trays**
(box open at the top, with a taller **front panel** that closes the compartment
opening and overhangs the sides as a stop) are laid out beside it, so both print
flat and support-free.

- **Width / Depth / Height** — the cabinet's outer size (independent, so it can
  be square or a shallow/wide desktop unit).
- **Drawers** — how many compartments (and drawer trays) to build.
- **Wall / Floor / Roof / Shelf thickness** — the cabinet walls, its base, its
  top and the dividers between compartments.
- **Drawer tray wall / tray floor / front panel thickness** — the tray's own
  walls and floor and the thickness of the front face.
- **Chamfer (cube edges)** — a straight **45° chamfer** applied to **all twelve
  outer edges** of the cabinet (the 4 vertical corners, the 4 top edges and the
  4 bottom edges). The drawer fronts are **full width** and carry the same
  chamfer on their left/right edges, so a closed cabinet reads as one beveled
  cube. The chamfer is clamped to the thinnest of the wall / floor / roof /
  front panel (a warning appears if it had to be reduced). 0&nbsp;mm gives the
  plain square box. The bevel overhangs at the bottom, so print with a brim.
- **Drawer fit clearance** — the gap between a drawer and its opening, per
  enclosed side (0.2–0.4&nbsp;mm suits most FDM printers).
- **Drawer vertical gap** — play left between a drawer's panel and its
  compartment so it never rubs.

**How it is built** — a heightfield cannot slope an outer face (its side walls
are always vertical) and can only staircase a corner, so the cabinet is built as
**one explicit closed polyhedron**: the chamfered box's 6 shrunken face
rectangles, its 12 edge-chamfer rectangles and 8 corner triangles, with the
front cavity cut as a rectangular pocket (the front face becomes a ring,
triangulated with `earcut`). The (N&nbsp;−&nbsp;1) shelves are exact boxes. Each
drawer is an explicit **full-width front panel** (two front vertical corners cut
by the chamfer) plus an explicit open-top **tray**, laid out in a column beside
the cabinet (a 6&nbsp;mm gap). Import as one object with multiple parts: the
slicer unions the cabinet, its shelves and the drawer trays, and each part takes
one extruder colour. (The mesh-level geometry tests check every part stays
watertight for chamfers 0–3&nbsp;mm across 1–6 drawers.)

## Terrain → 3D (`/terrain`) — experimental, may not work as expected

> **Experimental:** this tool may not work as expected. It depends on
> third-party network services (map tiles, elevation tiles, geocoding,
> building footprints) that can be slow or unavailable.

The third page turns elevation into a solid, printable tile. Two sources feed the
same geometry:

- **Upload heightmap** — any PNG / JPG / WebP; brightness becomes height (dark
  low, bright high, or invert it). *Auto-level* stretches the map to its real
  min/max.
- **Pick from map** — a Leaflet map (OpenStreetMap) with a selection box. The map
  **defaults to your current location** (browser geolocation, once) and has a
  **search box** (Nominatim geocoding) plus a "use my location" button to jump
  anywhere; clicking the map moves the box. The real elevation for the selected
  area is downloaded from the **AWS Open Data "Terrain Tiles"** dataset
  (`terrarium` PNGs — keyless and CORS-enabled, so it runs in the browser). The
  size sliders set the area in metres.

**How it is built** — the image is downscaled to the print grid; every cell is a
column from z = 0 (a solid base) up to `base + elevation`, snapped to whole
print layers. The mesh is the shared manifold heightfield (`lib/mesh.ts`), so
there are no non-manifold edges and slicers never offer to repair it. The
**live preview is meshed at a capped resolution** (128 px) and the
**full-resolution model is only built when you download**, so dragging sliders
stays smooth while exports keep every detail.

| Control | Range | Meaning |
| --- | --- | --- |
| Resolution | 40–320 px | grid across the longer ground side (export size; the live preview is capped at 128 px) |
| Print width | 40–300 mm | printed width; height follows the selection's aspect |
| Max relief height | 2–80 mm | crest height above the base |
| Base thickness | 0.5–6 mm | solid base under the relief |
| Print layer height | 0.08–0.3 mm | relief steps snap to whole layers (slice with the same height). Also keeps the mesh small and the preview fast |
| Sea level | 0–90 % | flatten everything below this to a "water" plane |
| Invert / Auto-level | toggles | upload source only |
| Colour bands | 1–6 | 1 = single colour; >1 steps the relief into flat colour plateaus, one extruder per band |
| Base plate | toggle | a solid plate of the base thickness extends `border width` beyond the relief; the relief is built on top of it |
| OSM buildings | toggle | fetch real building footprints (Overpass) and extrude them onto the terrain as a coloured part; metres-per-level, height multiplier and colour |

Exports the same **3MF / STL zip** as the other tools (see *Export* above).

**OpenStreetMap buildings** — with the toggle on, the tool queries the Overpass
API for the building footprints in the selected area and extrudes each into a
simple prism that sits on the terrain surface (flat base at the lowest ground
under the footprint, so it never floats). Heights come from the `height` tag, or
are estimated from `building:levels` × the metres-per-level setting (many OSM
buildings have no height, so treat them as approximate). It's a separate
coloured part, so it prints on its own extruder; the footprint count is capped
(zoom in for large areas).

**Vertical exaggeration** is shown for map terrain — the printed relief compared
with the ground's true scale (e.g. `1.8×`) — so it is obvious the model is not to
scale.

**Attribution** — map tiles © OpenStreetMap contributors; place search via
Nominatim (© OpenStreetMap contributors); building footprints via the Overpass
API (© OpenStreetMap contributors, ODbL); elevation from Mapzen / AWS Terrain
Tiles (SRTM, 3DEP and others). Attribution is required and is shown on the page.
Tiles are fetched only for the selected area (no prefetching), per the
OpenStreetMap tile usage policy.

**Privacy** — unlike the image and text tools, the terrain tool talks to the
network: it fetches map tiles from OpenStreetMap, elevation from AWS, building
footprints from Overpass, and — when you use the search box — the place-name
query from Nominatim. Your browser's location is requested once, only to centre
the map (and only if you allow it).


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
never silently move a setting. The terrain tool is covered as well: Web-Mercator
round trips, tile-range / zoom selection, terrarium encode ↔ decode, bilinear
resampling, and manifold terrain meshes (single colour, sea level, stepped colour
bands and the base plate). The badge and coaster builders are checked too: their
parts must come out manifold (plate + raised text; base + one part per colour;
and the single-filament relief coaster). The picture-frame builder is covered as
well: the tray must stay watertight for every supported shape, its footprint must
equal the plate plus the border, the air gap behind the plate must match the
setting, the wire hole must bore the back panel, the slide-in lip must leave the
top edge open (with the tab reaching it when the stop is on), and a bent
(curved) frame's vertices must stay inside the plate's radial band with the
rebate at the plate's bend radius.

## Project layout

```
app/               Next.js app router pages (/ image tool, /text sign tool,
                   /badge, /coaster, /frame, /box, /drawers, /terrain),
                   layout, styles
components/        Dropzone, Controls, PaletteEditor, Preview2D, Preview3D,
                   TextControls (text sign controls), BadgeControls,
                   CoasterControls, FrameControls (picture frame controls),
                   BoxControls (storage box controls),
                   DrawersControls (drawer cabinet controls),
                   TerrainControls (terrain controls),
                   MapPicker (Leaflet location picker), ToolNav (shared tabs),
                   PreviewGeneric (shared multi-part 3D viewer)
lib/quantize.ts    median cut + farthest-point seeded k-means, pixel mapping
lib/mesh.ts        pixel grid → merged rects → extruded box triangles
                   (arbitrary z0..z1 bands for layered mode)
lib/smoothExtrude.ts  binary mask → smooth extruded part: sub-pixel coverage
                   field, marching-squares contours (level 0.5), RDP +
                   Chaikin smoothing, even-odd scanline caps, side walls
lib/textSign.ts    text sign geometry: glyph raster, drop-cap stroke
                   compensation, automatic letter spacing / background
                   joining, rim + raised masks, two parts
lib/exporters.ts   binary STL writer, multi-part 3MF (JSZip) writer
lib/pipeline.ts    downscale + orchestration glue
lib/shapes.ts      shape outlines (unit-space polygons), silhouette, classifier
lib/slider.ts      slider text entry: parse, format, clamp and step-snap rules
lib/curve.ts       plate bend around a vertical axis (flat → full cylinder)
lib/terrain.ts     heightmap / map elevation → solid terrain (base, sea level,
                   stepped colour bands, base plate)
lib/terrainTiles.ts  AWS/Mapzen terrarium tile fetch + decode + resample
lib/geo.ts         Web-Mercator tile math (bbox ↔ tiles, zoom, ground size)
lib/geocode.ts     place-name search via OpenStreetMap Nominatim
lib/bounds.ts      bounding box + centre of triangle-soup parts
lib/masks.ts       canvas shape masks (badge/coaster) + erode / hole ops
lib/badge.ts       badge geometry: shaped plate + raised/engraved text + keyring hole
lib/coaster.ts     coaster geometry: shaped base + mosaic colours / relief
lib/frame.ts       picture-frame geometry: shaped tray + rebate + LED air gap
lib/framePrefill.ts  Image → 3D → Frame → 3D settings hand-off (sessionStorage)
lib/box.ts         storage-box geometry: shaped container + separate plug/recess lid
lib/hinge.ts       print-in-place pin/knuckle hinge solids (extruded profiles)
lib/boxPrefill.ts  Image → 3D → Box → 3D settings hand-off (sessionStorage)
lib/drawers.ts     drawer-cabinet geometry: open-front cabinet + shelf/roof slabs
                   + separate drawer trays (printed beside)
lib/buildings.ts   OSM building footprints (Overpass) → extruded prisms
scripts/           core-logic test + shape-outline tracer (trace-shape.ts)
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
print can take one of **30 outline shapes**: square, circle, heart, star,
diamond, cross, triangle, hexagon, Christmas tree, snowflake, stocking, bell,
gingerbread man, gingerbread woman, pumpkin, ghost, bat, leaf, maple leaf,
acorn, egg, bunny, flower, tulip, butterfly, shamrock, sun, shell, starfish and
moon.
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
- Mosaic: base color when a base slab exists; Filament 1 when the skin covers
  the full height (no base)
- Layered: Filament 1 (darkest auto-detected colour)
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
- 5 mm at 0.2 mm layer height = 25 layers; the base prints in one filament and
  only the top skin layers swap colors — that's normal for a mosaic.
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
- Signs: print the background part on the bed and the raised text on top of
  it, one filament per part. Keep the outline height at a multiple of your
  layer height, and make the raised-text extra height at least one layer so
  the inner section is not a sub-layer sliver.
- Signs with a very large first letter: the app already thins the enlarged
  glyph's strokes to match the rest, so the rim and the raised line weight
  stay even. If letters end up very close together, widen the outline
  instead of looking for a spacing control — there isn't one.
