"use client";

import { hexToRgb, rgbToHex, type RGB } from "@/lib/quantize";

export interface TextFontOption {
  label: string;
  family: string;
  importUrl?: string;
}

export const TEXT_FONTS: TextFontOption[] = [
  { label: "Inter (clean sans)", family: "Inter, system-ui, sans-serif" },
  { label: "Arial Black (heavy)", family: "'Arial Black', Arial, sans-serif" },
  { label: "Georgia (serif)", family: "Georgia, 'Times New Roman', serif" },
  {
    label: "Pacifico (script)",
    family: "'Pacifico', cursive",
    importUrl: "https://fonts.googleapis.com/css2?family=Pacifico&display=swap",
  },
  {
    label: "Lobster (display script)",
    family: "'Lobster', cursive",
    importUrl: "https://fonts.googleapis.com/css2?family=Lobster&display=swap",
  },
  {
    label: "Anton (bold condensed)",
    family: "'Anton', sans-serif",
    importUrl: "https://fonts.googleapis.com/css2?family=Anton&display=swap",
  },
  {
    label: "Bebas Neue (tall caps)",
    family: "'Bebas Neue', sans-serif",
    importUrl: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap",
  },
  { label: "Custom uploaded font", family: "__custom__" },
];

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm text-zinc-300">{props.label}</span>
        <span className="text-sm tabular-nums text-zinc-400">
          {props.value}
          {props.unit}
        </span>
      </div>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}

export function Swatch(props: {
  label: string;
  color: RGB;
  onChange: (c: RGB) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <label
        className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-zinc-600"
        title={`Click to change ${props.label}`}
      >
        <span
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: rgbToHex(props.color) }}
        />
        <input
          type="color"
          value={rgbToHex(props.color)}
          onChange={(e) => props.onChange(hexToRgb(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-zinc-200">
            {props.label}
          </span>
          <span className="font-mono text-xs uppercase text-zinc-500">
            {rgbToHex(props.color)}
          </span>
        </div>
      </div>
    </div>
  );
}

export interface TextControlValues {
  fontIdx: number;
  customFamily: string | null;
  bold: boolean;
  italic: boolean;
  firstLetterScale: number;
  lineHeight: number;
  widthMm: number;
  outlineMm: number;
  insetMm: number;
  baseHeightMm: number;
  topHeightMm: number;
  bg: RGB;
  fg: RGB;
}

export default function TextControls({
  v,
  onChange,
  onUploadFont,
  fontLoading,
}: {
  v: TextControlValues;
  onChange: (patch: Partial<TextControlValues>) => void;
  onUploadFont: (file: File) => void;
  fontLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-zinc-300" htmlFor="text-font">
          Font
        </label>
        <select
          id="text-font"
          value={v.fontIdx}
          onChange={(e) => onChange({ fontIdx: Number(e.target.value) })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {TEXT_FONTS.map((f, i) => (
            <option key={f.label} value={i}>
              {f.label}
            </option>
          ))}
        </select>
        <label className="mt-2 block cursor-pointer rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-center text-xs text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200">
          {fontLoading
            ? "Loading font…"
            : v.customFamily
              ? `Custom font loaded: ${v.customFamily} (click to replace)`
              : "Upload TTF / OTF — e.g. a script font (click)"}
          <input
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFont(f);
              e.target.value = "";
            }}
          />
        </label>
        <div className="mt-2 flex gap-4 text-sm text-zinc-300">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={v.bold}
              onChange={(e) => onChange({ bold: e.target.checked })}
              className="accent-emerald-500"
            />
            Bold
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={v.italic}
              onChange={(e) => onChange({ italic: e.target.checked })}
              className="accent-emerald-500"
            />
            Italic
          </label>
        </div>
      </div>
      <div className="space-y-2">
        <Swatch
          label="Outline (background)"
          color={v.bg}
          onChange={(bg) => onChange({ bg })}
        />
        <Swatch
          label="Raised text (foreground)"
          color={v.fg}
          onChange={(fg) => onChange({ fg })}
        />
      </div>
      <Slider label="Object width" value={v.widthMm} min={40} max={300} step={5} unit=" mm" onChange={(widthMm) => onChange({ widthMm })} />
      <Slider label="Outline width (rim)" value={v.outlineMm} min={0} max={6} step={0.2} unit=" mm" onChange={(outlineMm) => onChange({ outlineMm })} />
      <Slider label="Inner inset" value={v.insetMm} min={0} max={4} step={0.1} unit=" mm" onChange={(insetMm) => onChange({ insetMm })} />
      <Slider label="Outline height" value={v.baseHeightMm} min={1} max={10} step={0.2} unit=" mm" onChange={(baseHeightMm) => onChange({ baseHeightMm })} />
      <Slider label="Raised text extra height" value={v.topHeightMm} min={0.4} max={5} step={0.2} unit=" mm" onChange={(topHeightMm) => onChange({ topHeightMm })} />
      <Slider label="First letter size" value={v.firstLetterScale} min={1} max={2.5} step={0.05} unit="×" onChange={(firstLetterScale) => onChange({ firstLetterScale })} />
    </div>
  );
}
