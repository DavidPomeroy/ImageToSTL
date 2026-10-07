// Bridge between the Image → 3D tool and the Box → 3D tool.
//
// "Copy settings to Box → 3D" on the image page stashes the plate's outline,
// size and curvature here, then navigates to /box, which picks the values up on
// load — so a matching box (whose lid is the plate) can be made without
// re-entering anything. sessionStorage keeps it in the tab without ever
// touching a server.

import type { ShapeType } from "./shapes";

export interface BoxPrefill {
  /** Lid outline (the box supports the full rectangle + the standard shapes). */
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

/** Shapes the box tool can build (Full rectangle + the standard category). */
export const BOX_SHAPE_TYPES: ShapeType[] = [
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

const KEY = "imageto3d:box-prefill";

export function saveBoxPrefill(p: BoxPrefill): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable (private mode) — the box just opens with defaults.
  }
}

/** Read and clear the stashed prefill (one shot, per browser tab). */
export function takeBoxPrefill(): BoxPrefill | null {
  try {
    const s = sessionStorage.getItem(KEY);
    if (!s) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(s) as BoxPrefill;
  } catch {
    return null;
  }
}
