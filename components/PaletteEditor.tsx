"use client";

import { hexToRgb, rgbToHex, type RGB } from "@/lib/quantize";
import type { BandInfo } from "@/lib/pipeline";

export default function PaletteEditor({
  palette,
  counts,
  pixelArea,
  bands,
  stacked,
  onChange,
  onAuto,
}: {
  palette: RGB[];
  counts: number[];
  pixelArea: number;
  /** Per-color Z band (layered mode). */
  bands?: BandInfo[];
  /** Show bottom → top stack positions (layered mode). */
  stacked?: boolean;
  onChange: (index: number, color: RGB) => void;
  onAuto: () => void;
}) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {palette.map((c, i) => {
          const band = bands?.[i];
          return (
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
                    {stacked && (
                      <span className="ml-1 text-xs font-normal text-zinc-500">
                        {i === 0 ? "(bottom)" : i === palette.length - 1 ? "(top)" : ""}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-xs uppercase text-zinc-500">
                    {rgbToHex(c)}
                  </span>
                </div>
                <div className="text-xs tabular-nums text-zinc-500">
                  {(counts[i] ?? 0).toLocaleString()} px ·{" "}
                  {((counts[i] ?? 0) * pixelArea).toFixed(0)} mm²
                </div>
                {stacked && band && (
                  <div className="mt-0.5 text-xs tabular-nums text-emerald-400/80">
                    z {band.z0.toFixed(1)} → {band.z1.toFixed(1)} mm · layers{" "}
                    {band.layer0}–{band.layer1}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-zinc-500">
        {stacked
          ? "The stack prints in order: Filament 1 first, then each swap at the z-height shown. Click a swatch to match your actual filaments."
          : "Click a swatch to match a color to your actual filament. Pixels are re-assigned to the closest color automatically."}
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
