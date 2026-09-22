"use client";

import type { PrintMode } from "@/lib/pipeline";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, unit, onChange }: SliderProps) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-zinc-300">{label}</span>
        <span className="text-sm tabular-nums text-zinc-400">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}

const MODES = [
  ["mosaic", "Mosaic", "flat · 4 filaments"],
  ["layered", "Layered", "HueForge relief"],
  ["lithophane", "Lithophane", "backlit · 1 filament"],
] as const;

const DESCRIPTIONS: Record<PrintMode, string> = {
  mosaic:
    "Mosaic: each of the 4 colors is a separate part side by side, all the same thickness — print with 4 filaments on a multi-material printer (Bambu AMS, Prusa MMU, toolchanger).",
  layered:
    "Layered: filaments are stacked bottom → top (Filament 1 at the base). Each pixel's column stops at the top of its color's band — a HueForge-style variable-height relief.",
  lithophane:
    "Lithophane: a single-filament panel where thickness encodes brightness — dark areas print thick, bright areas thin. Backlight the finished print and the image appears.",
};

export default function Controls(props: {
  mode: PrintMode;
  resolution: number;
  widthMm: number;
  depthMm: number;
  layerHeight: number;
  minThickness: number;
  onMode: (m: PrintMode) => void;
  onResolution: (v: number) => void;
  onWidthMm: (v: number) => void;
  onDepthMm: (v: number) => void;
  onLayerHeight: (v: number) => void;
  onMinThickness: (v: number) => void;
}) {
  const layered = props.mode === "layered";
  const litho = props.mode === "lithophane";
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-sm text-zinc-300">Print mode</div>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {MODES.map(([m, label, hint]) => (
            <button
              key={m}
              type="button"
              onClick={() => props.onMode(m)}
              className={`rounded-md border px-2 py-2 text-center transition-colors ${
                props.mode === m
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[10px] leading-tight opacity-70">{hint}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          {DESCRIPTIONS[props.mode]}
        </p>
      </div>

      <Slider
        label="Resolution (longest side)"
        value={props.resolution}
        min={32}
        max={256}
        step={8}
        unit=" px"
        onChange={props.onResolution}
      />
      <Slider
        label="Plate width"
        value={props.widthMm}
        min={40}
        max={300}
        step={5}
        unit=" mm"
        onChange={props.onWidthMm}
      />
      {litho && (
        <Slider
          label="Min thickness (bright areas)"
          value={props.minThickness}
          min={0.4}
          max={2}
          step={0.2}
          unit=" mm"
          onChange={props.onMinThickness}
        />
      )}
      <Slider
        label={
          litho
            ? "Max thickness (dark areas)"
            : layered
              ? "Total height (max)"
              : "Thickness (Z depth)"
        }
        value={props.depthMm}
        min={2}
        max={12}
        step={0.5}
        unit=" mm"
        onChange={props.onDepthMm}
      />
      {(layered || litho) && (
        <>
          <Slider
            label="Print layer height"
            value={props.layerHeight}
            min={0.08}
            max={0.3}
            step={0.04}
            unit=" mm"
            onChange={props.onLayerHeight}
          />
          <p className="text-xs leading-relaxed text-zinc-500">
            {litho
              ? "Thickness steps snap to whole print layers — slice with this layer height for clean level changes."
              : "Band boundaries snap to whole print layers — slice with the same layer height you set here."}
          </p>
        </>
      )}
    </div>
  );
}
