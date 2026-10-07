"use client";

import { Slider, Swatch } from "@/components/TextControls";
import { FRAME_SHAPES, type FrameBack, type FrameRetain } from "@/lib/frame";
import type { RGB } from "@/lib/quantize";
import type { ShapeType } from "@/lib/shapes";

export interface FrameControlValues {
  // plate to receive
  plateWidthMm: number;
  plateHeightMm: number;
  plateThicknessMm: number;
  shapeType: ShapeType;
  shapeSize: number;
  // frame body
  clearanceMm: number;
  borderMm: number;
  ledgeMm: number;
  gapMm: number;
  revealMm: number;
  /** Plate curvature in degrees (0 = flat). */
  curveDeg: number;
  retain: FrameRetain;
  lipMm: number;
  lipOpenMm: number;
  topStop: boolean;
  // back / LED
  back: FrameBack;
  backMm: number;
  channelWidthMm: number;
  channelDepthMm: number;
  wireHoleMm: number;
  // output
  resolution: number;
  color: RGB;
}

export default function FrameControls({
  v,
  onChange,
}: {
  v: FrameControlValues;
  onChange: (patch: Partial<FrameControlValues>) => void;
}) {
  const patch = (p: Partial<FrameControlValues>) => onChange(p);
  const panel = v.back === "panel" || v.back === "channel";
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Plate shape</span>
        <select
          value={v.shapeType}
          onChange={(e) => patch({ shapeType: e.target.value as ShapeType })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {FRAME_SHAPES.map((s) => (
            <option key={s.type} value={s.type}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
        Frames follow the Image → 3D plate&apos;s outline — enter the plate&apos;s
        settings below so it drops in. Supports the full rectangle and the
        standard shapes.
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
        label="Border width"
        value={v.borderMm}
        min={2}
        max={40}
        step={0.5}
        unit=" mm"
        onChange={(borderMm) => patch({ borderMm })}
      />
      <Slider
        label="Fit clearance"
        value={v.clearanceMm}
        min={0}
        max={1}
        step={0.05}
        unit=" mm"
        onChange={(clearanceMm) => patch({ clearanceMm })}
      />
      <Slider
        label="Rebate ledge"
        value={v.ledgeMm}
        min={1}
        max={10}
        step={0.5}
        unit=" mm"
        onChange={(ledgeMm) => patch({ ledgeMm })}
      />
      <Slider
        label="Air gap behind plate"
        value={v.gapMm}
        min={0}
        max={40}
        step={0.5}
        unit=" mm"
        onChange={(gapMm) => patch({ gapMm })}
      />
      <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
        The air gap is the cavity behind the plate — room for an LED strip or
        board (8–15&nbsp;mm suits most).
      </p>
      <Slider
        label="Plate reveal"
        value={v.revealMm}
        min={0}
        max={10}
        step={0.5}
        unit=" mm"
        onChange={(revealMm) => patch({ revealMm })}
      />
      <Slider
        label="Curvature"
        value={v.curveDeg}
        min={0}
        max={360}
        step={10}
        unit="°"
        onChange={(curveDeg) => patch({ curveDeg })}
      />
      {v.curveDeg > 0 && (
        <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
          Match the Image → 3D &quot;Curvature&quot; setting — the frame bends
          around the same axis, so its rebate follows the curved plate (360° = a
          full lamp-shade cylinder).
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Retention</span>
        <select
          value={v.retain}
          onChange={(e) => patch({ retain: e.target.value as FrameRetain })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="rebate">Rebate only (friction / tape)</option>
          <option value="lip">Front lip (holds the plate edge)</option>
        </select>
      </label>
      {v.retain === "lip" && (
        <>
          <Slider
            label="Lip overlap"
            value={v.lipMm}
            min={0.5}
            max={6}
            step={0.5}
            unit=" mm"
            onChange={(lipMm) => patch({ lipMm })}
          />
          <Slider
            label="Top opening (slide-in)"
            value={v.lipOpenMm}
            min={0}
            max={40}
            step={1}
            unit=" mm"
            onChange={(lipOpenMm) => patch({ lipOpenMm })}
          />
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={v.topStop}
              onChange={(e) => patch({ topStop: e.target.checked })}
              className="accent-emerald-500"
            />
            Top stop tab (snap fit)
          </label>
          <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
            The plate slides in from the top edge and rests on the side/bottom
            lip. Keep a &gt;0 opening to insert it. The optional top tab is a
            press fit — leave it off for thick or rigid plates.
          </p>
        </>
      )}

      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">Back / LED</span>
        <select
          value={v.back}
          onChange={(e) => patch({ back: e.target.value as FrameBack })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="open">Open back (rear LED access)</option>
          <option value="panel">Back panel + wire hole</option>
          <option value="channel">Back panel + LED channel</option>
        </select>
      </label>
      {panel && (
        <Slider
          label="Back panel thickness"
          value={v.backMm}
          min={0.6}
          max={6}
          step={0.2}
          unit=" mm"
          onChange={(backMm) => patch({ backMm })}
        />
      )}
      {panel && (
        <Slider
          label="Wire hole diameter"
          value={v.wireHoleMm}
          min={0}
          max={15}
          step={0.5}
          unit=" mm"
          onChange={(wireHoleMm) => patch({ wireHoleMm })}
        />
      )}
      {v.back === "channel" && (
        <>
          <Slider
            label="Channel width"
            value={v.channelWidthMm}
            min={4}
            max={20}
            step={0.5}
            unit=" mm"
            onChange={(channelWidthMm) => patch({ channelWidthMm })}
          />
          <Slider
            label="Channel depth"
            value={v.channelDepthMm}
            min={0.2}
            max={3}
            step={0.1}
            unit=" mm"
            onChange={(channelDepthMm) => patch({ channelDepthMm })}
          />
        </>
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
        label="Frame colour"
        color={v.color}
        onChange={(color) => patch({ color })}
      />
    </div>
  );
}

