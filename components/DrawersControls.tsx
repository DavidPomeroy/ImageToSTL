"use client";

import { Slider, Swatch } from "@/components/TextControls";
import type { RGB } from "@/lib/quantize";

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
  // output
  resolution: number;
  color: RGB;
  drawerColor: RGB;
  frontColor: RGB;
  trayWallStyle: "solid" | "hex";
  hexMm: number;
}

export default function DrawersControls({
  v,
  onChange,
}: {
  v: DrawersControlValues;
  onChange: (patch: Partial<DrawersControlValues>) => void;
}) {
  const patch = (p: Partial<DrawersControlValues>) => onChange(p);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Slider
          label="Width"
          value={v.cabinetWidthMm}
          min={40}
          max={300}
          step={1}
          unit=" mm"
          onChange={(cabinetWidthMm) => patch({ cabinetWidthMm })}
        />
        <Slider
          label="Depth"
          value={v.cabinetDepthMm}
          min={40}
          max={300}
          step={1}
          unit=" mm"
          onChange={(cabinetDepthMm) => patch({ cabinetDepthMm })}
        />
        <Slider
          label="Height"
          value={v.cabinetHeightMm}
          min={40}
          max={300}
          step={1}
          unit=" mm"
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
        A straight 45° chamfer on the cube&apos;s outer edges. The cabinet&apos;s
        own front face stays square behind the drawer fronts; the fronts fill that
        front slab and carry the chamfer there — the top and bottom panels&apos;
        outer ends included — so a closed chest is one chamfered cube. Limited by
        the thinnest wall / floor / roof / front.
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
    </div>
  );
}
