"use client";

import { Slider, Swatch, TEXT_FONTS } from "@/components/TextControls";
import type { BadgeShape } from "@/lib/masks";
import type { RGB } from "@/lib/quantize";

export const BADGE_SHAPES: { id: BadgeShape; label: string }[] = [
  { id: "rounded", label: "Rounded rectangle" },
  { id: "square", label: "Rectangle" },
  { id: "circle", label: "Circle" },
  { id: "dogtag", label: "Dog tag" },
  { id: "hexagon", label: "Hexagon" },
  { id: "heart", label: "Heart" },
  { id: "star", label: "Star" },
];

export interface BadgeControlValues {
  text: string;
  fontIdx: number;
  customFamily: string | null;
  bold: boolean;
  italic: boolean;
  shape: BadgeShape;
  widthMm: number;
  heightMm: number;
  cornerMm: number;
  plateMm: number;
  textMm: number;
  textScale: number;
  marginMm: number;
  holeEnabled: boolean;
  holeMm: number;
  holeInsetMm: number;
  plateColor: RGB;
  textColor: RGB;
}

export default function BadgeControls({
  v,
  onChange,
  onUploadFont,
  fontLoading,
}: {
  v: BadgeControlValues;
  onChange: (patch: Partial<BadgeControlValues>) => void;
  onUploadFont: (file: File) => void;
  fontLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Text</span>
        <textarea
          value={v.text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          placeholder="Name or short text (Enter = new line)"
          className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        />
      </label>

      <div>
        <label className="mb-1 block text-sm text-zinc-300" htmlFor="badge-font">
          Font
        </label>
        <select
          id="badge-font"
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
              : "Upload TTF / OTF (click)"}
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

      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Shape</span>
        <select
          value={v.shape}
          onChange={(e) => onChange({ shape: e.target.value as BadgeShape })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {BADGE_SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <Swatch
          label="Plate colour"
          color={v.plateColor}
          onChange={(plateColor) => onChange({ plateColor })}
        />
        <Swatch
          label="Text colour"
          color={v.textColor}
          onChange={(textColor) => onChange({ textColor })}
        />
      </div>

      <Slider label="Width" value={v.widthMm} min={20} max={120} step={1} unit=" mm" onChange={(widthMm) => onChange({ widthMm })} />
      <Slider label="Height" value={v.heightMm} min={20} max={120} step={1} unit=" mm" onChange={(heightMm) => onChange({ heightMm })} />
      <Slider label="Corner radius" value={v.cornerMm} min={0} max={30} step={0.5} unit=" mm" onChange={(cornerMm) => onChange({ cornerMm })} />
      <Slider label="Plate thickness" value={v.plateMm} min={1} max={6} step={0.2} unit=" mm" onChange={(plateMm) => onChange({ plateMm })} />
      <Slider label="Text height" value={v.textMm} min={0.4} max={4} step={0.1} unit=" mm" onChange={(textMm) => onChange({ textMm })} />
      <Slider label="Text size" value={v.textScale} min={0.3} max={1} step={0.05} unit="×" onChange={(textScale) => onChange({ textScale })} />
      <Slider label="Margin" value={v.marginMm} min={1} max={15} step={0.5} unit=" mm" onChange={(marginMm) => onChange({ marginMm })} />

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={v.holeEnabled}
          onChange={(e) => onChange({ holeEnabled: e.target.checked })}
          className="accent-emerald-500"
        />
        Keyring hole
      </label>
      {v.holeEnabled && (
        <>
          <Slider label="Hole diameter" value={v.holeMm} min={2} max={10} step={0.5} unit=" mm" onChange={(holeMm) => onChange({ holeMm })} />
          <Slider
            label={`Hole from ${
              v.shape === "dogtag" && v.widthMm >= v.heightMm ? "left" : "top"
            }`}
            value={v.holeInsetMm}
            min={0}
            max={15}
            step={0.5}
            unit=" mm"
            onChange={(holeInsetMm) => onChange({ holeInsetMm })}
          />
          {v.shape === "dogtag" && v.widthMm >= v.heightMm && (
            <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
              A wide dog tag hangs from its left end, so the hole sits on the
              left and the text shifts right to clear it.
            </p>
          )}
          {(v.shape === "heart" || v.shape === "star") && (
            <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
              The top of this shape is{" "}
              {v.shape === "heart" ? "a notch" : "a point"}, so the hole is
              placed at the highest spot inside the material where it fits.
            </p>
          )}
        </>
      )}
    </div>
  );
}
