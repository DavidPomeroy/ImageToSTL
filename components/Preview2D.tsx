"use client";

import { useEffect, useRef } from "react";
import { EMPTY, type RGB } from "@/lib/quantize";

export default function Preview2D({
  grid,
  gw,
  gh,
  palette,
}: {
  grid: Uint8Array;
  gw: number;
  gh: number;
  palette: RGB[];
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
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i];
      if (g === EMPTY) continue; // stays transparent -> empty space in the print
      const c = palette[g];
      if (!c) continue;
      const o = i * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [grid, gw, gh, palette]);

  return (
    <canvas
      ref={ref}
      className="w-full rounded-lg border border-zinc-800 [background:repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] [background-size:16px_16px] [image-rendering:pixelated]"
    />
  );
}
