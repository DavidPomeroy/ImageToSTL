"use client";

import { useEffect, useRef } from "react";
import { EMPTY, type RGB } from "@/lib/quantize";

export default function Preview2D({
  grid,
  gw,
  gh,
  palette,
  heights,
  hMin,
  hMax,
}: {
  grid: Uint8Array;
  gw: number;
  gh: number;
  palette: RGB[];
  /** Lithophane mode: per-pixel thickness in mm, rendered as a backlit-style grayscale. */
  heights?: Float32Array;
  hMin?: number;
  hMax?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(gw, gh);

    if (heights) {
      // approximate backlit appearance: thinner areas glow brighter
      const lo = hMin ?? 0;
      const range = Math.max(1e-6, (hMax ?? 1) - lo);
      for (let i = 0; i < heights.length; i++) {
        const h = heights[i];
        if (h <= 0) continue; // empty -> stays transparent
        const v = Math.round(255 * (1 - (h - lo) / range));
        const o = i * 4;
        img.data[o] = v;
        img.data[o + 1] = v;
        img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    } else {
      for (let i = 0; i < grid.length; i++) {
        const g = grid[i];
        if (g === EMPTY) continue; // stays transparent -> empty space
        const c = palette[g];
        if (!c) continue;
        const o = i * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [grid, gw, gh, palette, heights, hMin, hMax]);

  return (
    <canvas
      ref={ref}
      className="w-full rounded-lg border border-zinc-800 [background:repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] [background-size:16px_16px] [image-rendering:pixelated]"
    />
  );
}
