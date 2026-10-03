"use client";

import { useEffect, useRef } from "react";
import { EMPTY, type RGB } from "@/lib/quantize";
import { shapeOutlinePoints, type ShapeType } from "@/lib/shapes";

export interface ShapeOverlay {
  type: ShapeType;
  /** center in image pixels */
  cx: number;
  cy: number;
  /** shape radius in image pixels */
  radiusPx: number;
  /** border width in image pixels (visualised as a thick outline) */
  borderPx: number;
  /** pixel-space crop rect for type === "custom" (origin = top-left) */
  cropRect?: { x0: number; y0: number; x1: number; y1: number };
}

export default function Preview2D({
  grid,
  gw,
  gh,
  palette,
  heights,
  hMin,
  hMax,
  cmykPreview,
  shapeOverlay,
  /** Mosaic border: pixel mask painted on top in the border (base) color. */
  borderMask,
  borderColor,
  onShapeMove,
}: {
  grid: Uint8Array;
  gw: number;
  gh: number;
  palette: RGB[];
  /** Lithophane mode: per-pixel thickness in mm, rendered as a backlit-style grayscale. */
  heights?: Float32Array;
  hMin?: number;
  hMax?: number;
  /** CMYK lithophane: simulated backlit RGBA, drawn directly. */
  cmykPreview?: Uint8ClampedArray;
  /** Outline + crosshair overlay for the selected shape. */
  shapeOverlay?: ShapeOverlay | null;
  borderMask?: Uint8Array;
  borderColor?: RGB;
  /** Click/drag on the preview moves the shape center (normalized 0..1). */
  onShapeMove?: (cx: number, cy: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(gw, gh);

    if (cmykPreview) {
      img.data.set(cmykPreview);
    } else if (heights) {
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
      // Mosaic border ring prints in the base color — repaint those pixels.
      if (borderMask && borderColor) {
        for (let i = 0; i < grid.length; i++) {
          if (!borderMask[i] || grid[i] === EMPTY) continue;
          const o = i * 4;
          img.data[o] = borderColor[0];
          img.data[o + 1] = borderColor[1];
          img.data[o + 2] = borderColor[2];
          img.data[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // shape outline + center crosshair
    if (shapeOverlay) {
      const { type, cx, cy, radiusPx, borderPx, cropRect } = shapeOverlay;
      if (type === "custom") {
        if (cropRect) {
          ctx.strokeStyle = "rgba(52, 211, 153, 0.9)";
          ctx.lineWidth = Math.max(1, borderPx > 0 ? Math.max(1, borderPx * 2) : 1);
          ctx.strokeRect(
            cropRect.x0,
            cropRect.y0,
            cropRect.x1 - cropRect.x0,
            cropRect.y1 - cropRect.y0
          );
          // center crosshair
          ctx.strokeStyle = "rgba(52, 211, 153, 0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - (cropRect.x1 - cropRect.x0) * 0.04, cy);
          ctx.lineTo(cx + (cropRect.x1 - cropRect.x0) * 0.04, cy);
          ctx.moveTo(cx, cy - (cropRect.y1 - cropRect.y0) * 0.04);
          ctx.lineTo(cx, cy + (cropRect.y1 - cropRect.y0) * 0.04);
          ctx.stroke();
        }
      } else if (type !== "rectangle") {
        const pts = shapeOutlinePoints(type);
        ctx.strokeStyle = "rgba(52, 211, 153, 0.9)";
        ctx.lineWidth = Math.max(1, borderPx > 0 ? Math.max(1, borderPx * 2) : 1);
        ctx.beginPath();
        for (let k = 0; k < pts.length; k++) {
          const [ux, uy] = pts[k];
          const px = cx + ux * radiusPx;
          const py = cy - uy * radiusPx; // image y grows downward
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        // center crosshair
        ctx.strokeStyle = "rgba(52, 211, 153, 0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - radiusPx * 0.08, cy);
        ctx.lineTo(cx + radiusPx * 0.08, cy);
        ctx.moveTo(cx, cy - radiusPx * 0.08);
        ctx.lineTo(cx, cy + radiusPx * 0.08);
        ctx.stroke();
      }
    }
  }, [
    grid,
    gw,
    gh,
    palette,
    heights,
    hMin,
    hMax,
    cmykPreview,
    shapeOverlay,
    borderMask,
    borderColor,
  ]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas || !onShapeMove) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    onShapeMove(
      Math.max(0, Math.min(1, cx)),
      Math.max(0, Math.min(1, cy))
    );
  };

  return (
    <canvas
      ref={ref}
      onPointerDown={(e) => {
        if (!onShapeMove) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        pick(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      className={`w-full rounded-lg border border-zinc-800 [background:repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] [background-size:16px_16px] [image-rendering:pixelated] ${
        onShapeMove ? "cursor-crosshair" : ""
      }`}
    />
  );
}
