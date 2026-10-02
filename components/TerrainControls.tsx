"use client";

import { Slider, Swatch } from "@/components/TextControls";
import type { RGB } from "@/lib/quantize";

/** Hypsometric ramp (low → high) used for the stepped colour bands. */
export const DEFAULT_BAND_COLORS: RGB[] = [
  [46, 110, 66],
  [120, 150, 80],
  [176, 155, 96],
  [140, 110, 84],
  [205, 205, 205],
  [245, 245, 245],
];

export interface TerrainControlValues {
  source: "upload" | "map";
  resolution: number;
  widthMm: number;
  reliefMm: number;
  baseMm: number;
  seaLevelPct: number;
  invert: boolean;
  autoLevel: boolean;
  /** Snap relief heights to whole print layers (0 = no snapping). */
  layerHeight: number;
  bands: number;
  bandColors: RGB[];
  color: RGB;
  frameEnabled: boolean;
  frameWidthMm: number;
  frameColor: RGB;
  mapWidthM: number;
  mapHeightM: number;
  /** Add OSM building footprints (map source). */
  buildings: boolean;
  metresPerLevel: number;
  buildingHeightScale: number;
  buildingColor: RGB;
}

function Toggle(props: {
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="mt-0.5 accent-emerald-500"
      />
      <span>
        {props.label}
        {props.hint && (
          <span className="block text-xs leading-relaxed text-zinc-500">
            {props.hint}
          </span>
        )}
      </span>
    </label>
  );
}

export default function TerrainControls({
  v,
  onChange,
}: {
  v: TerrainControlValues;
  onChange: (patch: Partial<TerrainControlValues>) => void;
}) {
  const upload = v.source === "upload";
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["upload", "map"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange({ source: s })}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              v.source === s
                ? "border-emerald-500/40 bg-emerald-500/15 font-medium text-emerald-300"
                : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            {s === "upload" ? "Upload heightmap" : "Pick from map"}
          </button>
        ))}
      </div>

      {!upload && (
        <>
          <Slider
            label="Selection width"
            value={v.mapWidthM}
            min={200}
            max={40000}
            step={100}
            unit=" m"
            onChange={(mapWidthM) => onChange({ mapWidthM })}
          />
          <Slider
            label="Selection height"
            value={v.mapHeightM}
            min={200}
            max={40000}
            step={100}
            unit=" m"
            onChange={(mapHeightM) => onChange({ mapHeightM })}
          />
          <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
            Click the map to move the box. Smaller selections print finer
            relief; large ones fetch more tiles.
          </p>
        </>
      )}

      <Slider
        label="Resolution"
        value={v.resolution}
        min={40}
        max={320}
        step={10}
        unit=" px"
        onChange={(resolution) => onChange({ resolution })}
      />
      <Slider
        label="Print width"
        value={v.widthMm}
        min={40}
        max={300}
        step={5}
        unit=" mm"
        onChange={(widthMm) => onChange({ widthMm })}
      />
      <Slider
        label="Max relief height"
        value={v.reliefMm}
        min={2}
        max={80}
        step={1}
        unit=" mm"
        onChange={(reliefMm) => onChange({ reliefMm })}
      />
      <Slider
        label="Base thickness"
        value={v.baseMm}
        min={0.5}
        max={6}
        step={0.25}
        unit=" mm"
        onChange={(baseMm) => onChange({ baseMm })}
      />
      <Slider
        label="Print layer height"
        value={v.layerHeight}
        min={0.08}
        max={0.3}
        step={0.04}
        unit=" mm"
        onChange={(layerHeight) => onChange({ layerHeight })}
      />
      <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
        Relief steps snap to whole print layers — slice with the same layer
        height you set here. This also keeps the mesh small and the preview
        fast.
      </p>
      <Slider
        label="Sea level (flatten below)"
        value={v.seaLevelPct}
        min={0}
        max={90}
        step={5}
        unit=" %"
        onChange={(seaLevelPct) => onChange({ seaLevelPct })}
      />

      {upload && (
        <div className="space-y-2">
          <Toggle
            label="Invert (white = low)"
            checked={v.invert}
            onChange={(invert) => onChange({ invert })}
          />
          <Toggle
            label="Auto-level"
            hint="Stretch the map to its real min/max"
            checked={v.autoLevel}
            onChange={(autoLevel) => onChange({ autoLevel })}
          />
        </div>
      )}

      <Slider
        label="Colour bands (1 = single colour)"
        value={v.bands}
        min={1}
        max={6}
        step={1}
        unit=""
        onChange={(bands) => onChange({ bands })}
      />
      {v.bands <= 1 ? (
        <Swatch
          label="Terrain colour"
          color={v.color}
          onChange={(color) => onChange({ color })}
        />
      ) : (
        <div className="space-y-2">
          {Array.from({ length: v.bands }, (_, k) => (
            <Swatch
              key={k}
              label={`Band ${k + 1} (low → high)`}
              color={
                v.bandColors[k] ??
                DEFAULT_BAND_COLORS[k % DEFAULT_BAND_COLORS.length]
              }
              onChange={(c) => {
                const next = v.bandColors.slice();
                while (next.length < v.bands)
                  next.push(DEFAULT_BAND_COLORS[next.length % 6]);
                next[k] = c;
                onChange({ bandColors: next });
              }}
            />
          ))}
          <p className="text-xs leading-relaxed text-zinc-500">
            Elevation is stepped into flat colour plateaus and stacked — one
            extruder per band.
          </p>
        </div>
      )}

      <Toggle
        label="Base plate (coloured border)"
        checked={v.frameEnabled}
        onChange={(frameEnabled) => onChange({ frameEnabled })}
      />
      {v.frameEnabled && (
        <>
          <Slider
            label="Border width"
            value={v.frameWidthMm}
            min={1}
            max={12}
            step={0.5}
            unit=" mm"
            onChange={(frameWidthMm) => onChange({ frameWidthMm })}
          />
          <Swatch
            label="Base plate colour"
            color={v.frameColor}
            onChange={(frameColor) => onChange({ frameColor })}
          />
          <p className="text-xs leading-relaxed text-zinc-500">
            A solid plate of the base thickness extends beyond the relief — the
            relief is built on top of it.
          </p>
        </>
      )}

      <Toggle
        label="OpenStreetMap buildings"
        hint="Fetch real building footprints for this area and extrude them onto the terrain"
        checked={v.buildings}
        onChange={(buildings) => onChange({ buildings })}
      />
      {v.buildings && (
        <>
          <Slider
            label="Metres per level"
            value={v.metresPerLevel}
            min={2}
            max={5}
            step={0.1}
            unit=" m"
            onChange={(metresPerLevel) => onChange({ metresPerLevel })}
          />
          <Slider
            label="Building height"
            value={v.buildingHeightScale}
            min={0.5}
            max={2}
            step={0.1}
            unit="×"
            onChange={(buildingHeightScale) => onChange({ buildingHeightScale })}
          />
          <Swatch
            label="Building colour"
            color={v.buildingColor}
            onChange={(buildingColor) => onChange({ buildingColor })}
          />
          <p className="-mt-1 text-xs leading-relaxed text-zinc-500">
            Heights come from the OSM height tag, or are estimated from building
            levels. Data © OpenStreetMap contributors (ODbL).
          </p>
        </>
      )}
    </div>
  );
}
