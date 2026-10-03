"use client";

import type { PrintMode } from "@/lib/pipeline";
import { hexToRgb, rgbToHex, type RGB } from "@/lib/quantize";
import {
  SHAPE_CATEGORIES,
  shapeCategoryOf,
  type ShapeCategory,
  type ShapeType,
} from "@/lib/shapes";
import { formatSliderValue, resolveSliderCommit } from "@/lib/slider";
import { useRef, useState } from "react";

const ALWAYS_SHAPES: [ShapeType, string][] = [
  ["rectangle", "Full"],
  ["custom", "Custom"],
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
  // The readout doubles as a text field. While typing, a local draft keeps
  // partial input ("0." or a lone "-") alive; blur / Enter commits it — the
  // entry is clamped to the range and snapped to the slider's step — while Esc
  // (or an entry with no number in it) reverts to the current value.
  const [draft, setDraft] = useState<string | null>(null);
  // First click into the field selects the whole value so typing replaces it;
  // a later click places the caret for fine editing.
  const freshClick = useRef(true);
  const cancelled = useRef(false);
  const text = draft ?? formatSliderValue(value, step);

  const commit = (raw: string) => {
    const wasCancelled = cancelled.current;
    cancelled.current = false;
    setDraft(null);
    const next = resolveSliderCommit(raw, value, min, max, step, wasCancelled);
    if (next !== null) onChange(next);
  };

  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm text-zinc-300">{label}</span>
        <span className="flex items-baseline">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${label} value`}
            title="Type a value, or drag the slider"
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onMouseUp={(e) => {
              if (freshClick.current) {
                e.currentTarget.select();
                freshClick.current = false;
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur(); // blur commits
              } else if (e.key === "Escape") {
                cancelled.current = true;
                setDraft(null);
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              freshClick.current = true;
              commit(e.currentTarget.value);
            }}
            className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-sm tabular-nums text-zinc-400 transition-colors hover:border-zinc-700 focus:border-emerald-500/50 focus:bg-zinc-950 focus:text-zinc-200 focus:outline-none"
          />
          {unit !== "" && (
            <span className="whitespace-pre text-sm tabular-nums text-zinc-400">
              {unit}
            </span>
          )}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          setDraft(null);
          onChange(Number(e.target.value));
        }}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}

const MODES = [
  ["mosaic", "Mosaic", "flat multi-material"],
  ["layered", "Layered", "HueForge relief"],
  ["lithophane", "Lithophane", "backlit · 1 filament"],
  ["cmyk", "CMYK", "color litho · 4 filaments"],
] as const;

const DESCRIPTIONS: Record<PrintMode, string> = {
  mosaic:
    "Mosaic: each color is a separate part side by side, all the same thickness — print on a multi-material printer (Bambu AMS, Prusa MMU, toolchanger).",
  layered:
    "Layered: filaments are stacked bottom → top (Filament 1 at the base). Each pixel's column stops at the top of its color's band — a HueForge-style variable-height relief.",
  lithophane:
    "Lithophane: a single-filament panel where thickness encodes brightness — dark areas print thick, bright areas thin. Backlight the finished print and the image appears.",
  cmyk:
    "CMYK lithophane: thin Cyan / Magenta / Yellow layers mix subtractively for color, and a white relief on top controls brightness. Backlight it to see a full-color image. Needs 4 filaments (AMS/MMU).",
};

function ShapePicker(props: {
  shapeType: ShapeType;
  onShapeType: (t: ShapeType) => void;
}) {
  // Which category tab the seasonal shapes come from. If the current shape
  // is seasonal, open on its category; otherwise default to Standard.
  const [category, setCategory] = useState<ShapeCategory>(
    () => shapeCategoryOf(props.shapeType) ?? "standard"
  );
  const active = SHAPE_CATEGORIES.find((c) => c.id === category)!;
  const btn = (t: ShapeType, label: string) => (
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
  );
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
        {ALWAYS_SHAPES.map(([t, label]) => btn(t, label))}
      </div>
      <select
        aria-label="Shape collection"
        value={category}
        onChange={(e) => {
          const next = e.target.value as ShapeCategory;
          setCategory(next);
          // Auto-select the first shape in the newly chosen collection so
          // the preview always reflects the dropdown.
          const first = SHAPE_CATEGORIES.find((c) => c.id === next)!.shapes[0];
          props.onShapeType(first.type);
        }}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-xs font-medium text-zinc-300 focus:border-emerald-500/50 focus:outline-none"
      >
        {SHAPE_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
        {active.shapes.map((s) => btn(s.type, s.label))}
      </div>
    </div>
  );
}

export default function Controls(props: {
  mode: PrintMode;
  colorCount: number;
  resolution: number;
  widthMm: number;
  depthMm: number;
  layerHeight: number;
  minThickness: number;
  colorLayers: number;
  whiteMinLayers: number;
  whiteMaxLayers: number;
  mosaicTopMm: number;
  mosaicBaseColor: RGB;
  smooth: boolean;
  shapeType: ShapeType;
  shapeSize: number;
  shapeCropW: number;
  shapeCropH: number;
  borderMm: number;
  curveDeg: number;
  onMode: (m: PrintMode) => void;
  onColorCount: (v: number) => void;
  onResolution: (v: number) => void;
  onWidthMm: (v: number) => void;
  onDepthMm: (v: number) => void;
  onLayerHeight: (v: number) => void;
  onMinThickness: (v: number) => void;
  onColorLayers: (v: number) => void;
  onWhiteMinLayers: (v: number) => void;
  onWhiteMaxLayers: (v: number) => void;
  onMosaicTopMm: (v: number) => void;
  onMosaicBaseColor: (c: RGB) => void;
  onSmooth: (v: boolean) => void;
  onShapeType: (t: ShapeType) => void;
  onShapeSize: (v: number) => void;
  onShapeCropW: (v: number) => void;
  onShapeCropH: (v: number) => void;
  onBorderMm: (v: number) => void;
  onCurveDeg: (v: number) => void;
}) {
  const layered = props.mode === "layered";
  const litho = props.mode === "lithophane";
  const cmyk = props.mode === "cmyk";
  const mosaic = props.mode === "mosaic";
  const paletteMode = props.mode === "mosaic" || props.mode === "layered";
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

      {paletteMode && (
        <Slider
          label="Number of colors"
          value={props.colorCount}
          min={2}
          max={16}
          step={1}
          unit=" filaments"
          onChange={props.onColorCount}
        />
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
        <ShapePicker
          shapeType={props.shapeType}
          onShapeType={props.onShapeType}
        />
        {props.shapeType === "custom" ? (
          <>
            <div className="mt-3 space-y-2">
              <Slider
                label="Crop width"
                value={Math.round(props.shapeCropW * 100)}
                min={5}
                max={100}
                step={5}
                unit="%"
                onChange={(v) => props.onShapeCropW(v / 100)}
              />
              <Slider
                label="Crop height"
                value={Math.round(props.shapeCropH * 100)}
                min={5}
                max={100}
                step={5}
                unit="%"
                onChange={(v) => props.onShapeCropH(v / 100)}
              />
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">
              Click or drag on the preview to position the crop. Width/height
              are fractions of the image — everything outside the rectangle is
              cut away.
            </p>
          </>
        ) : (
          props.shapeType !== "rectangle" && (
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
              Click or drag on the preview to position the shape. The outline
              is cut along the exact shape, so straight sides and curves come
              out smooth — not stepped along the pixel grid.
            </p>
            </>
          )
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
          {layered
            ? "Border prints in Filament 1."
            : cmyk
              ? "Border prints solid dark (full CMY + max white)."
              : mosaic
                ? props.mosaicTopMm < props.depthMm - 1e-9
                  ? "Border prints in the base color."
                  : "Border prints in Filament 1 (no base slab)."
                : "Border prints at maximum thickness (darkest backlit)."}
        </p>
      )}
      <Slider
        label="Curvature"
        value={props.curveDeg}
        min={0}
        max={360}
        step={10}
        unit="°"
        onChange={props.onCurveDeg}
      />
      {props.curveDeg > 0 && (
        <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
          The plate bends around a vertical axis — image surface faces outward.
          360° closes into a cylinder (with a tiny printable seam gap).
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

      {mosaic && (
        <>
          <Slider
            label="Top color thickness"
            value={props.mosaicTopMm}
            min={0.2}
            max={props.depthMm}
            step={0.2}
            unit=" mm"
            onChange={props.onMosaicTopMm}
          />
          {props.mosaicTopMm < props.depthMm - 1e-9 ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <label
                  className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-zinc-600"
                  title="Click to change the base color"
                >
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundColor: rgbToHex(props.mosaicBaseColor) }}
                  />
                  <input
                    type="color"
                    value={rgbToHex(props.mosaicBaseColor)}
                    onChange={(e) => props.onMosaicBaseColor(hexToRgb(e.target.value))}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-200">
                      Base color
                    </span>
                    <span className="font-mono text-xs uppercase text-zinc-500">
                      {rgbToHex(props.mosaicBaseColor)}
                    </span>
                  </div>
                  <div className="text-xs tabular-nums text-zinc-500">
                    Solid slab under the color skin
                  </div>
                </div>
              </div>
              <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
                The plate prints as a solid base in this color with a thin color
                skin on top — snapping to whole print layers.
              </p>
            </>
          ) : (
            <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
              The color skin covers the full thickness — full-height color
              columns, no base slab.
            </p>
          )}
        </>
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

      {(layered || litho || cmyk || mosaic) && (
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
                : mosaic
                  ? "Total height and the top color skin snap to whole print layers — slice with the same layer height you set here."
                  : "Band boundaries snap to whole print layers — slice with the same layer height you set here."}
          </p>
        </>
      )}
    </div>
  );
}
