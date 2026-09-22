"use client";

import { hexToRgb, rgbToHex, type RGB } from "@/lib/quantize";

export default function PaletteEditor({
  palette,
  counts,
  pixelArea,
  onChange,
  onAuto,
}: {
  palette: RGB[];
  counts: number[];
  pixelArea: number;
  onChange: (index: number, color: RGB) => void;
  onAuto: () => void;
}) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {palette.map((c, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
          >
            <label
              className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-zinc-600"
              title="Click to change this color"
            >
              <span
                className="pointer-events-none absolute inset-0"
                style={{ backgroundColor: rgbToHex(c) }}
              />
              <input
                type="color"
                value={rgbToHex(c)}
                onChange={(e) => onChange(i, hexToRgb(e.target.value))}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-zinc-200">
                  Filament {i + 1}
                </span>
                <span className="font-mono text-xs uppercase text-zinc-500">
                  {rgbToHex(c)}
                </span>
              </div>
              <div className="text-xs tabular-nums text-zinc-500">
                {(counts[i] ?? 0).toLocaleString()} px ·{" "}
                {((counts[i] ?? 0) * pixelArea).toFixed(0)} mm²
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">
        Click a swatch to match a color to your actual filament. Pixels are
        re-assigned to the closest color automatically.
      </p>
      <button
        type="button"
        onClick={onAuto}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
      >
        Re-detect colors from image
      </button>
    </div>
  );
}
