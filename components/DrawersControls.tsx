"use client";

import { Slider, Swatch } from "@/components/TextControls";
import Dropzone from "@/components/Dropzone";
import { DECOR_FACES, DECOR_FACE_LABELS, type DecorFace } from "@/lib/decor";
import { hexToRgb, rgbToHex, type RGB } from "@/lib/quantize";

export interface DrawersControlValues {
  // cabinet body
  cabinetWidthMm: number;
  cabinetDepthMm: number;
  cabinetHeightMm: number;
  wallMm: number;
  floorMm: number;
  roofMm: number;
  shelfMm: number;
  shelfRailMm: number;
  // drawers
  drawerCount: number;
  trayWallMm: number;
  trayFloorMm: number;
  frontMm: number;
  chamferMm: number;
  fitClearanceMm: number;
  gapMm: number;
  // decoration (an uploaded image, inlaid into the chosen faces)
  /** Faces carrying the design; empty = no decoration. */
  decorFaces: DecorFace[];
  decorRecessMm: number;
  decorProudMm: number;
  decorClearanceMm: number;
  /** Fill transparent regions enclosed by the drawing (line art → solid shape). */
  decorFill: boolean;
  decorSizePct: number;
  decorResolution: number;
  decorColorCount: number;
  decorBackgroundInlay: boolean;
  /** The recess base plate's colour: "face" = the face's own filament. */
  decorBackground: "face" | RGB;
  /** Which palette entries print as inlay parts. */
  decorInlay: boolean[];
  // output
  resolution: number;
  color: RGB;
  drawerColor: RGB;
  frontColor: RGB;
  trayWallStyle: "solid" | "hex";
  hexMm: number;
}

/** The image side of the decoration, owned by the page. */
export interface DrawersDecorUi {
  fileName: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  /** Detected colours, with the pixel count each covers. */
  palette: RGB[];
  counts: number[];
  /** True when the image was read as line art (filled, raised applique). */
  lineArt: boolean;
  onPalette: (index: number, color: RGB) => void;
  onInlay: (index: number, on: boolean) => void;
  onAutoPalette: () => void;
}


export default function DrawersControls({
  v,
  onChange,
  decor,
}: {
  v: DrawersControlValues;
  onChange: (patch: Partial<DrawersControlValues>) => void;
  decor: DrawersDecorUi;
}) {
  const patch = (p: Partial<DrawersControlValues>) => onChange(p);
  const faceOn = (f: DecorFace) => v.decorFaces.includes(f);
  const toggleFace = (f: DecorFace) =>
    patch({
      decorFaces: faceOn(f)
        ? v.decorFaces.filter((x) => x !== f)
        : [...v.decorFaces, f],
    });
  const bgColor = v.decorBackground === "face" ? v.color : v.decorBackground;
  // The palette is padded to the requested colour count; entries that cover no
  // cells are not useful (they would show as 0 px swatches). Keep them only if
  // the image is blank and nothing else would be listed.
  const counted = decor.palette
    .map((color, index) => ({ color, index, n: decor.counts[index] ?? 0 }))
    .filter((row) => row.n > 0);
  const paletteRows =
    counted.length > 0
      ? counted
      : decor.palette.map((color, index) => ({
          color,
          index,
          n: decor.counts[index] ?? 0,
        }));
  return (
    <div className="space-y-4">
      {/* Cube size: three compact sliders share one row (the panel is only
          340px wide, so a normal label + value row would collide here) */}
      <div className="grid grid-cols-3 gap-3">
        <Slider
          compact
          label="Width"
          value={v.cabinetWidthMm}
          min={40}
          max={300}
          step={1}
          unit="mm"
          onChange={(cabinetWidthMm) => patch({ cabinetWidthMm })}
        />
        <Slider
          compact
          label="Depth"
          value={v.cabinetDepthMm}
          min={40}
          max={300}
          step={1}
          unit="mm"
          onChange={(cabinetDepthMm) => patch({ cabinetDepthMm })}
        />
        <Slider
          compact
          label="Height"
          value={v.cabinetHeightMm}
          min={40}
          max={300}
          step={1}
          unit="mm"
          onChange={(cabinetHeightMm) => patch({ cabinetHeightMm })}
        />
      </div>
      <Slider
        label="Drawers"
        value={v.drawerCount}
        min={1}
        max={8}
        step={1}
        unit=""
        onChange={(drawerCount) => patch({ drawerCount: Math.round(drawerCount) })}
      />

      <Slider
        label="Wall thickness"
        value={v.wallMm}
        min={1}
        max={10}
        step={0.2}
        unit=" mm"
        onChange={(wallMm) => patch({ wallMm })}
      />
      <Slider
        label="Floor thickness"
        value={v.floorMm}
        min={0.8}
        max={10}
        step={0.2}
        unit=" mm"
        onChange={(floorMm) => patch({ floorMm })}
      />
      <Slider
        label="Roof thickness"
        value={v.roofMm}
        min={0.8}
        max={10}
        step={0.2}
        unit=" mm"
        onChange={(roofMm) => patch({ roofMm })}
      />
      <Slider
        label="Shelf thickness"
        value={v.shelfMm}
        min={0.8}
        max={10}
        step={0.2}
        unit=" mm"
        onChange={(shelfMm) => patch({ shelfMm })}
      />
      <Slider
        label="Shelf rail width"
        value={v.shelfRailMm}
        min={2}
        max={40}
        step={1}
        unit=" mm"
        onChange={(shelfRailMm) => patch({ shelfRailMm })}
      />
      <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
        Each shelf is two side rails (this wide) rather than a full slab, so the
        drawer tray rests on them and the middle of the compartment stays open.
        The cube prints on its back with the opening facing up, so nothing
        bridges over the cavity. The interior (height − floor − roof − shelves)
        is split evenly into {v.drawerCount} compartment
        {v.drawerCount > 1 ? "s" : ""}.
      </p>

      <Slider
        label="Drawer tray wall"
        value={v.trayWallMm}
        min={1}
        max={6}
        step={0.2}
        unit=" mm"
        onChange={(trayWallMm) => patch({ trayWallMm })}
      />
      <Slider
        label="Drawer tray floor"
        value={v.trayFloorMm}
        min={0.8}
        max={6}
        step={0.2}
        unit=" mm"
        onChange={(trayFloorMm) => patch({ trayFloorMm })}
      />
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">
          Tray side / back walls
        </span>
        <select
          value={v.trayWallStyle}
          onChange={(e) =>
            patch({ trayWallStyle: e.target.value as "solid" | "hex" })
          }
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="solid">Solid</option>
          <option value="hex">Hexagon pattern (saves filament)</option>
        </select>
      </label>
      {v.trayWallStyle === "hex" && (
        <Slider
          label="Hexagon size"
          value={v.hexMm}
          min={4}
          max={25}
          step={0.5}
          unit=" mm"
          onChange={(hexMm) => patch({ hexMm })}
        />
      )}
      <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
        The tray is open at the front — the drawer front closes it, and each side
        wall&apos;s exposed end is cut with the dovetail that locks the two
        together. The left, right and back walls can be perforated with a hex
        honeycomb (the hole size above; a web is left between the holes) to use
        less filament.
      </p>
      <Slider
        label="Front panel thickness"
        value={v.frontMm}
        min={1.5}
        max={20}
        step={0.5}
        unit=" mm"
        onChange={(frontMm) => patch({ frontMm })}
      />
      <Slider
        label="Chamfer (cube edges)"
        value={v.chamferMm}
        min={0}
        max={8}
        step={0.5}
        unit=" mm"
        onChange={(chamferMm) => patch({ chamferMm })}
      />
      <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
        A straight 45° chamfer on all twelve of the cube&apos;s outer edges. The
        drawer fronts fill the cube&apos;s front slab and carry the chamfer there
        — the side edges on every panel, the top and bottom ends of the outermost
        ones, and the front-to-back corner edges too — so a closed chest is one
        clean chamfered cube. Limited by the thinnest wall / floor / roof / front.
      </p>
      <Slider
        label="Drawer fit clearance"
        value={v.fitClearanceMm}
        min={0.05}
        max={0.8}
        step={0.05}
        unit=" mm"
        onChange={(fitClearanceMm) => patch({ fitClearanceMm })}
      />
      <Slider
        label="Drawer vertical gap"
        value={v.gapMm}
        min={0}
        max={2}
        step={0.1}
        unit=" mm"
        onChange={(gapMm) => patch({ gapMm })}
      />

      <Slider
        label="Resolution"
        value={v.resolution}
        min={120}
        max={500}
        step={10}
        unit=" px"
        onChange={(resolution) => patch({ resolution })}
      />
      <Swatch
        label="Cabinet colour"
        color={v.color}
        onChange={(color) => patch({ color })}
      />
      <Swatch
        label="Drawer tray colour"
        color={v.drawerColor}
        onChange={(drawerColor) => patch({ drawerColor })}
      />
      <Swatch
        label="Drawer front colour"
        color={v.frontColor}
        onChange={(frontColor) => patch({ frontColor })}
      />
      {/* ---- decoration: an uploaded image, inlaid into the chosen faces ---- */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-zinc-300">
            Decoration (image inlay / applique)
          </span>
          {decor.fileName && (
            <button
              type="button"
              onClick={decor.onRemove}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Remove
            </button>
          )}
        </div>
        <Dropzone
          onFile={decor.onFile}
          fileName={decor.fileName}
          note="PNG · JPG · WebP — line art can be filled; other transparent areas stay empty"
        />
        {decor.palette.length > 0 && (
          <>
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={v.decorFill}
                  onChange={(e) => patch({ decorFill: e.target.checked })}
                  className="mt-0.5 accent-emerald-500"
                />
                <span>
                  Fill enclosed outlines
                  {decor.lineArt && (
                    <span className="ml-1 text-xs font-normal text-emerald-400">
                      · line art detected
                    </span>
                  )}
                </span>
              </label>
              <p className="mt-1 pl-6 text-xs leading-relaxed text-zinc-500">
                Line art is drawn as an outline on a transparent background, so
                the enclosed areas are the real design. This fills them into
                solid shapes (a question mark&apos;s body and each rivet disc)
                while leaving its counters and holes open. Turn it off to cut the
                drawn strokes themselves.
              </p>
            </div>
            <div className="mt-3">
              <span className="mb-1 block text-sm text-zinc-300">
                Faces to decorate
              </span>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                {DECOR_FACES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFace(f)}
                    aria-pressed={faceOn(f)}
                    className={`rounded-md border px-1 py-1.5 text-center text-xs font-medium transition-colors ${
                      faceOn(f)
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-transparent text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {DECOR_FACE_LABELS[f]}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                The front&apos;s design spans the whole front and is split across
                the drawer fronts (a clear seam each side), so no part crosses a
                drawer or lifts off it. The other five faces sit on the cabinet
                itself.
              </p>
            </div>
            <div className="mt-3 space-y-3">
              <Slider
                label="Recess depth"
                value={v.decorRecessMm}
                min={0}
                max={4}
                step={0.2}
                unit=" mm"
                onChange={(decorRecessMm) => patch({ decorRecessMm })}
              />
              <Slider
                label="Inlay proud of the face"
                value={v.decorProudMm}
                min={0}
                max={8}
                step={0.5}
                unit=" mm"
                onChange={(decorProudMm) => patch({ decorProudMm })}
              />
              <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
                Recess 0 with a proud height prints a raised applique glued
                straight onto the face (the look of the reference question-mark
                block); no base plate is printed. A recessed inlay uses the recess
                depth plus the proud height as its part thickness.
              </p>
              <Slider
                label="Inlay fit clearance"
                value={v.decorClearanceMm}
                min={0}
                max={1}
                step={0.1}
                unit=" mm"
                onChange={(decorClearanceMm) => patch({ decorClearanceMm })}
              />
              <Slider
                label="Design size"
                value={Math.round(v.decorSizePct * 100)}
                min={20}
                max={100}
                step={5}
                unit="%"
                onChange={(pct) => patch({ decorSizePct: pct / 100 })}
              />
              <Slider
                label="Design resolution"
                value={v.decorResolution}
                min={48}
                max={256}
                step={8}
                unit=" px"
                onChange={(decorResolution) =>
                  patch({ decorResolution: Math.round(decorResolution) })
                }
              />
              <Slider
                label="Design colours"
                value={v.decorColorCount}
                min={2}
                max={8}
                step={1}
                unit=""
                onChange={(n) => patch({ decorColorCount: Math.round(n) })}
              />
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm text-zinc-300">Inlay colours</span>
                <button
                  type="button"
                  onClick={decor.onAutoPalette}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Re-detect
                </button>
              </div>
              <ul className="space-y-2">
                {paletteRows.map(({ color: c, index: i, n }) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1.5"
                  >
                    <label
                      className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-zinc-600"
                      title="Click to match this colour to your filament"
                    >
                      <span
                        className="pointer-events-none absolute inset-0"
                        style={{ backgroundColor: rgbToHex(c) }}
                      />
                      <input
                        type="color"
                        value={rgbToHex(c)}
                        onChange={(e) =>
                          decor.onPalette(i, hexToRgb(e.target.value))
                        }
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                    </label>
                    <span className="min-w-0 flex-1 text-xs tabular-nums text-zinc-500">
                      {n.toLocaleString()} px
                    </span>
                    <label className="flex shrink-0 items-center gap-1 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={v.decorInlay[i] === true}
                        onChange={(e) => decor.onInlay(i, e.target.checked)}
                        className="accent-emerald-500"
                      />
                      inlay
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            {v.decorRecessMm > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <label
                  className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-zinc-600"
                  title="The base plate's colour"
                >
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundColor: rgbToHex(bgColor) }}
                  />
                  <input
                    type="color"
                    value={rgbToHex(bgColor)}
                    disabled={v.decorBackground === "face"}
                    onChange={(e) =>
                      patch({ decorBackground: hexToRgb(e.target.value) })
                    }
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                </label>
                <span className="text-sm text-zinc-300">Recess base</span>
                <label className="ml-auto flex items-center gap-1 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={v.decorBackground === "face"}
                    onChange={(e) =>
                      patch({ decorBackground: e.target.checked ? "face" : bgColor })
                    }
                    className="accent-emerald-500"
                  />
                  face colour
                </label>
                <label className="flex items-center gap-1 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={v.decorBackgroundInlay}
                    onChange={(e) =>
                      patch({ decorBackgroundInlay: e.target.checked })
                    }
                    className="accent-emerald-500"
                  />
                  print it
                </label>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500">
                The recess is spanned by a base plate whose holes are exactly the
                design&apos;s outline, so every inlaid colour drops into a pocket
                cut to its own shape. Printed in the face&apos;s own colour it
                disappears into the surface, and the whole set glues in flush.
                Turn &ldquo;print it&rdquo; off to leave the recess open, or tick
                a colour off to leave it as bare recess instead of printing it.
                Untick &ldquo;face colour&rdquo; to print the base in another
                filament.
              </p>
            </div>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                Recess depth is 0: the parts print as a raised applique glued
                straight onto the face, so there is no recess and no base plate.
              </p>
            )}
          </>
        )}
      </div>

    </div>
  );
}
