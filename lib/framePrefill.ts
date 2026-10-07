// Bridge between the Image → 3D tool and the Frame → 3D tool.
//
// "Copy settings to Frame → 3D" on the image page stashes the plate's outline,
// size and curvature here, then navigates to /frame, which picks the values up
// on load — so a matching frame can be made without re-entering anything.
// sessionStorage keeps it in the tab without ever touching a server.

import type { ShapeType } from "./shapes";

export interface FramePrefill {
  /** Plate outline (frame supports the full rectangle + the standard shapes). */
  shapeType: ShapeType;
  /** Shape centre across the plate, 0..1 (standard shapes only). */
  shapeCx: number;
  /** Shape centre down the plate, 0..1 (standard shapes only). */
  shapeCy: number;
  /** Shape span as a fraction of the plate's smaller side. */
  shapeSize: number;
  plateWidthMm: number;
  plateHeightMm: number;
  plateThicknessMm: number;
  curveDeg: number;
}

/** Shapes the frame tool can build (Full rectangle + the standard category). */
export const FRAME_SHAPE_TYPES: ShapeType[] = [
  "rectangle",
  "square",
  "triangle",
  "hexagon",
  "circle",
  "heart",
  "star",
  "diamond",
  "cross",
];

const KEY = "imageto3d:frame-prefill";

export function saveFramePrefill(p: FramePrefill): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable (private mode) — the frame just opens with defaults.
  }
}

/** Read and clear the stashed prefill (one shot, per browser tab). */
export function takeFramePrefill(): FramePrefill | null {
  try {
    const s = sessionStorage.getItem(KEY);
    if (!s) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(s) as FramePrefill;
  } catch {
    return null;
  }
}
