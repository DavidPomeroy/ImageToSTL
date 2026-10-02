"use client";

import { Slider, Swatch } from "@/components/TextControls";
import type { CoasterShape } from "@/lib/masks";
import type { RGB } from "@/lib/quantize";

export const COASTER_SHAPES: { id: CoasterShape; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "hexagon", label: "Hexagon" },
  { id: "octagon", label: "Octagon" },
  { id: "rounded", label: "Rounded square" },
  { id: "square", label: "Square" },
];

export interface CoasterControlValues {
  shape: CoasterShape;
  sizeMm: number;
  baseMm: number;
  rimMm: number;
  cornerMm: number;
  mode: "mosaic" | "relief";
  depthMm: number;
  resolution: number;
  baseColor: RGB;
  /** Mosaic: number of filaments detected / exported. */
  colorCount: number;
  reliefInvert: boolean;
}

export default function CoasterControls({
  v,
  onChange,
}: {
  v: CoasterControlValues;
  onChange: (patch: Partial<CoasterControlValues>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["mosaic", "relief"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ mode: m })}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition-colors ${
              v.mode === m
                ? "border-emerald-500/40 bg-emerald-500/15 font-medium text-emerald-300"
                : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
        {v.mode === "mosaic"
          ? "Flat multi-colour image raised inside the rim (one extruder per colour)."
          : "Single-filament relief: a raised rim with the image engraved in the well."}
      </p>

      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Shape</span>
        <select
          value={v.shape}
          onChange={(e) => onChange({ shape: e.target.value as CoasterShape })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {COASTER_SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <Slider
        label="Size (width)"
        value={v.sizeMm}
        min={50}
        max={160}
        step={1}
        unit=" mm"
        onChange={(sizeMm) => onChange({ sizeMm })}
      />
      <Slider
        label="Base thickness"
        value={v.baseMm}
        min={1}
        max={6}
        step={0.2}
        unit=" mm"
        onChange={(baseMm) => onChange({ baseMm })}
      />
      <Slider
        label="Rim width"
        value={v.rimMm}
        min={0}
        max={15}
        step={0.5}
        unit=" mm"
        onChange={(rimMm) => onChange({ rimMm })}
      />
      {v.shape === "rounded" && (
        <Slider
          label="Corner radius"
          value={v.cornerMm}
          min={0}
          max={30}
          step={0.5}
          unit=" mm"
          onChange={(cornerMm) => onChange({ cornerMm })}
        />
      )}
      <Slider
        label={v.mode === "mosaic" ? "Colour height" : "Relief depth"}
        value={v.depthMm}
        min={0.2}
        max={3}
        step={0.1}
        unit=" mm"
        onChange={(depthMm) => onChange({ depthMm })}
      />
      <Slider
        label="Resolution"
        value={v.resolution}
        min={80}
        max={400}
        step={10}
        unit=" px"
        onChange={(resolution) => onChange({ resolution })}
      />
      <Swatch
        label={v.mode === "mosaic" ? "Rim / base colour" : "Coaster colour"}
        color={v.baseColor}
        onChange={(baseColor) => onChange({ baseColor })}
      />
      {v.mode === "mosaic" && (
        <Slider
          label="Number of colours"
          value={v.colorCount}
          min={2}
          max={8}
          step={1}
          unit=""
          onChange={(colorCount) => onChange({ colorCount })}
        />
      )}
      {v.mode === "relief" && (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={v.reliefInvert}
            onChange={(e) => onChange({ reliefInvert: e.target.checked })}
            className="accent-emerald-500"
          />
          Invert relief (white = low)
        </label>
      )}
    </div>
  );
}
