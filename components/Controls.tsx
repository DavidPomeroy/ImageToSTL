"use client";

import type { PrintMode } from "@/lib/pipeline";
import type { ShapeType } from "@/lib/shapes";

const SHAPE_BUTTONS: [ShapeType, string][] = [
  ["rectangle", "Full"],
  ["square", "Square"],
  ["triangle", "Triangle"],
  ["hexagon", "Hexagon"],
  ["circle", "Circle"],
  ["heart", "Heart"],
  ["star", "Star"],
];

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
  ["cmyk", "CMYK", "color litho · 4 filaments"],
] as const;

const DESCRIPTIONS: Record<PrintMode, string> = {
  mosaic:
    "Mosaic: each of the 4 colors is a separate part side by side, all the same thickness — print with 4 filaments on a multi-material printer (Bambu AMS, Prusa MMU, toolchanger).",
  layered:
    "Layered: filaments are stacked bottom → top (Filament 1 at the base). Each pixel's column stops at the top of its color's band — a HueForge-style variable-height relief.",
  lithophane:
    "Lithophane: a single-filament panel where thickness encodes brightness — dark areas print thick, bright areas thin. Backlight the finished print and the image appears.",
  cmyk:
    "CMYK lithophane: thin Cyan / Magenta / Yellow layers mix subtractively for color, and a white relief on top controls brightness. Backlight it to see a full-color image. Needs 4 filaments (AMS/MMU).",
};

export default function Controls(props: {
  mode: PrintMode;
  resolution: number;
  widthMm: number;
  depthMm: number;
  layerHeight: number;
  minThickness: number;
  colorLayers: number;
  whiteMinLayers: number;
  whiteMaxLayers: number;
  smooth: boolean;
  shapeType: ShapeType;
  shapeSize: number;
  borderMm: number;
  onMode: (m: PrintMode) => void;
  onResolution: (v: number) => void;
  onWidthMm: (v: number) => void;
  onDepthMm: (v: number) => void;
  onLayerHeight: (v: number) => void;
  onMinThickness: (v: number) => void;
  onColorLayers: (v: number) => void;
  onWhiteMinLayers: (v: number) => void;
  onWhiteMaxLayers: (v: number) => void;
  onSmooth: (v: boolean) => void;
  onShapeType: (t: ShapeType) => void;
  onShapeSize: (v: number) => void;
  onBorderMm: (v: number) => void;
}) {
  const layered = props.mode === "layered";
  const litho = props.mode === "lithophane";
  const cmyk = props.mode === "cmyk";
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-sm text-zinc-300">Print mode</div>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
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

      {(litho || cmyk) && (
        <div>
          <div className="mb-1 text-sm text-zinc-300">Surface</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {(
              [
                [false, "Pixelated", "blocky steps"],
                [true, "Smoothed", "interpolated relief"],
              ] as const
            ).map(([v, label, hint]) => (
              <button
                key={label}
                type="button"
                onClick={() => props.onSmooth(v)}
                className={`rounded-md border px-2 py-2 text-center transition-colors ${
                  props.smooth === v
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <div className="text-sm font-medium">{label}</div>
                <div className="text-[10px] leading-tight opacity-70">{hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <Slider
        label="Resolution (longest side)"
        value={props.resolution}
        min={32}
        max={512}
        step={8}
        unit=" px"
        onChange={props.onResolution}
      />
      <div>
        <div className="mb-1 text-sm text-zinc-300">Shape</div>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {SHAPE_BUTTONS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => props.onShapeType(t)}
              className={`rounded-md border px-1 py-2 text-center text-xs font-medium transition-colors ${
                props.shapeType === t
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {props.shapeType !== "rectangle" && (
          <>
            <div className="mt-3">
              <Slider
                label="Shape size"
                value={Math.round(props.shapeSize * 100)}
                min={5}
                max={150}
                step={5}
                unit="%"
                onChange={(v) => props.onShapeSize(v / 100)}
              />
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">
              Click or drag on the preview to position the shape.
            </p>
          </>
        )}
      </div>

      <Slider
        label="Border width"
        value={props.borderMm}
        min={0}
        max={5}
        step={0.25}
        unit=" mm"
        onChange={props.onBorderMm}
      />
      {props.borderMm > 0 && (
        <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
          {layered || litho
            ? "Border prints in Filament 1."
            : cmyk
              ? "Border prints solid dark (full CMY + max white)."
              : "Border prints at maximum thickness (darkest backlit)."}
        </p>
      )}

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
      {!cmyk && (
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
      )}

      {cmyk && (
        <>
          <Slider
            label="Layers per color channel (max)"
            value={props.colorLayers}
            min={1}
            max={8}
            step={1}
            unit=""
            onChange={props.onColorLayers}
          />
          <Slider
            label="White layers (min)"
            value={props.whiteMinLayers}
            min={1}
            max={6}
            step={1}
            unit=""
            onChange={props.onWhiteMinLayers}
          />
          <Slider
            label="White layers (max)"
            value={props.whiteMaxLayers}
            min={4}
            max={30}
            step={1}
            unit=""
            onChange={props.onWhiteMaxLayers}
          />
        </>
      )}

      {(layered || litho || cmyk) && (
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
            {cmyk
              ? "All color and white steps are whole print layers — slice with this layer height."
              : litho
                ? "Thickness steps snap to whole print layers — slice with this layer height for clean level changes."
                : "Band boundaries snap to whole print layers — slice with the same layer height you set here."}
          </p>
        </>
      )}
    </div>
  );
}
