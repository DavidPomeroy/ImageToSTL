"use client";

import { Slider, Swatch } from "@/components/TextControls";
import { BOX_SHAPES, type BoxLid } from "@/lib/box";
import type { RGB } from "@/lib/quantize";
import type { ShapeType } from "@/lib/shapes";

export interface BoxControlValues {
  // plate that becomes the lid
  plateWidthMm: number;
  plateHeightMm: number;
  plateThicknessMm: number;
  shapeType: ShapeType;
  shapeSize: number;
  // box body
  wallMm: number;
  depthMm: number;
  // lid
  lid: BoxLid;
  overhangMm: number;
  clearanceMm: number;
  plugDepthMm: number;
  plugBevelDeg: number;
  hingeClearanceMm: number;
  // output
  resolution: number;
  color: RGB;
}

export default function BoxControls({
  v,
  onChange,
}: {
  v: BoxControlValues;
  onChange: (patch: Partial<BoxControlValues>) => void;
}) {
  const patch = (p: Partial<BoxControlValues>) => onChange(p);
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Lid shape</span>
        <select
          value={v.shapeType}
          onChange={(e) => patch({ shapeType: e.target.value as ShapeType })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {BOX_SHAPES.map((s) => (
            <option key={s.type} value={s.type}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
        The box matches the Image → 3D plate&apos;s outline — enter the
        plate&apos;s settings below so the lid sits correctly. Supports the full
        rectangle and the standard shapes.
      </p>

      <Slider
        label="Plate width"
        value={v.plateWidthMm}
        min={20}
        max={300}
        step={1}
        unit=" mm"
        onChange={(plateWidthMm) => patch({ plateWidthMm })}
      />
      <Slider
        label="Plate height"
        value={v.plateHeightMm}
        min={20}
        max={300}
        step={1}
        unit=" mm"
        onChange={(plateHeightMm) => patch({ plateHeightMm })}
      />
      <Slider
        label="Plate thickness"
        value={v.plateThicknessMm}
        min={0.6}
        max={20}
        step={0.2}
        unit=" mm"
        onChange={(plateThicknessMm) => patch({ plateThicknessMm })}
      />
      {v.shapeType !== "rectangle" && (
        <Slider
          label="Shape size"
          value={v.shapeSize}
          min={0.2}
          max={1}
          step={0.02}
          unit=""
          onChange={(shapeSize) => patch({ shapeSize })}
        />
      )}

      <Slider
        label="Box depth"
        value={v.depthMm}
        min={5}
        max={120}
        step={1}
        unit=" mm"
        onChange={(depthMm) => patch({ depthMm })}
      />
      <Slider
        label="Wall thickness"
        value={v.wallMm}
        min={0.8}
        max={8}
        step={0.2}
        unit=" mm"
        onChange={(wallMm) => patch({ wallMm })}
      />

      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Lid</span>
        <select
          value={v.lid}
          onChange={(e) => patch({ lid: e.target.value as BoxLid })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="none">Open box (no lid)</option>
          <option value="separate">Separate lid (printed beside the box)</option>
          <option value="hinged">Hinged lid (print-in-place)</option>
          <option value="hinged-separate">
            Hinged lid (separate parts, assemble)
          </option>
        </select>
      </label>
      {v.lid !== "none" && (
        <>
          <Slider
            label="Lid overhang"
            value={v.overhangMm}
            min={0.4}
            max={Math.max(0.6, v.wallMm - 0.6)}
            step={0.1}
            unit=" mm"
            onChange={(overhangMm) => patch({ overhangMm })}
          />
          <Slider
            label="Fit clearance"
            value={v.clearanceMm}
            min={0.05}
            max={0.8}
            step={0.05}
            unit=" mm"
            onChange={(clearanceMm) => patch({ clearanceMm })}
          />
          <Slider
            label="Plug depth"
            value={v.plugDepthMm}
            min={1}
            max={Math.max(2, Math.min(20, v.depthMm - 1))}
            step={0.5}
            unit=" mm"
            onChange={(plugDepthMm) => patch({ plugDepthMm })}
          />
          <Slider
            label="Plug bevel"
            value={v.plugBevelDeg}
            min={0}
            max={45}
            step={5}
            unit="°"
            onChange={(plugBevelDeg) => patch({ plugBevelDeg })}
          />
        </>
      )}
      {v.lid === "separate" && (
        <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
          The lid sits on the box rim and its plug drops into the opening; the
          plate drops into a recess on the lid. Print the plate (Image → 3D)
          separately and seat it in the lid.
        </p>
      )}
      {(v.lid === "hinged" || v.lid === "hinged-separate") && (
        <Slider
          label="Hinge clearance"
          value={v.hingeClearanceMm}
          min={0.1}
          max={0.5}
          step={0.05}
          unit=" mm"
          onChange={(hingeClearanceMm) => patch({ hingeClearanceMm })}
        />
      )}
      {v.lid === "hinged" && (
        <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
          A print-in-place pin hinge runs along the shape&apos;s flat{" "}
          <em>top</em> edge, so it fits the rectangle, square, hexagon, diamond
          and cross nicely. Outlines whose top comes to a point (triangle, star,
          circle, heart) fall back to a separate lid. Break the hinge free with a
          gentle wiggle after printing; 0.2–0.35&nbsp;mm clearance suits most FDM
          printers.
        </p>
      )}
      {v.lid === "hinged-separate" && (
        <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
          The hinged lid prints flat beside the box — no support needed — and its
          knuckles slide onto the box&apos;s pin from one end to assemble, so the
          lid hinges open. Needs a flat <em>top</em> edge (rectangle, square,
          hexagon, diamond, cross); a pointed top (triangle, star, circle, heart)
          falls back to a plain separate lid.
        </p>
      )}

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
        label="Box colour"
        color={v.color}
        onChange={(color) => patch({ color })}
      />
    </div>
  );
}
