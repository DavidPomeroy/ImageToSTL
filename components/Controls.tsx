"use client";

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

export default function Controls(props: {
  resolution: number;
  widthMm: number;
  depthMm: number;
  onResolution: (v: number) => void;
  onWidthMm: (v: number) => void;
  onDepthMm: (v: number) => void;
}) {
  return (
    <div className="space-y-4">
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
      <Slider
        label="Thickness (Z depth)"
        value={props.depthMm}
        min={2}
        max={12}
        step={0.5}
        unit=" mm"
        onChange={props.onDepthMm}
      />
      <p className="text-xs leading-relaxed text-zinc-500">
        Produces a flat plate (5&nbsp;mm thick by default) where each of the 4
        colors is a separate part — print it with 4 filaments on a
        multi-material printer (Bambu AMS, Prusa MMU, toolchanger).
      </p>
    </div>
  );
}
