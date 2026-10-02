// OpenStreetMap buildings for the terrain tool: fetch building footprints from
// the Overpass API (ODbL, CORS-enabled, keyless) and extrude them into simple
// flat-based prisms that sit on the terrain surface.
//
// Only `way` buildings are used (the common case); footprints are single rings
// (no holes), and heights come from the `height` tag or `building:levels`
// (estimated), falling back to a default.

import earcut from "earcut";
import { latToTileY, type BBox } from "./geo";
import type { RGB } from "./quantize";
import type { TriangleSoup } from "./mesh";

export interface BuildingFootprint {
  /** Footprint ring as [lng, lat]; the closing point is not repeated. */
  ring: [number, number][];
  /** Explicit `height` tag in metres, if present. */
  heightM?: number;
  /** `building:levels` tag, if present. */
  levels?: number;
}

export interface BuildingsFetch {
  buildings: BuildingFootprint[];
  /** True when the result was capped to `maxBuildings`. */
  truncated: boolean;
}

export interface BuildingOptions {
  /** Metres per storey when only `building:levels` is available. */
  metresPerLevel: number;
  /** Fallback height (m) for buildings with no height data. */
  defaultHeightM: number;
  /** Safety cap on the number of footprints. */
  maxBuildings: number;
}

const OVERPASS = "https://overpass-api.de/api/interpreter";

/** Resolve a footprint's height in metres. */
export function buildingHeight(
  b: BuildingFootprint,
  metresPerLevel: number,
  defaultHeightM: number
): number {
  if (b.heightM && b.heightM > 0) return b.heightM;
  if (b.levels && b.levels > 0) return b.levels * metresPerLevel;
  return defaultHeightM;
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(String(v).replace(",", "."));
  return isFinite(n) && n > 0 ? n : undefined;
}

/** Fetch building footprints for a bbox (Overpass). Throws on network errors. */
export async function fetchBuildings(
  bbox: BBox,
  opts: BuildingOptions
): Promise<BuildingsFetch> {
  const query =
    `[out:json][timeout:25];(` +
    `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `);out geom;`;
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429 || res.status === 504
        ? "The building service is busy — try a smaller area in a moment."
        : `Building lookup failed (${res.status}).`
    );
  }
  const json = (await res.json()) as {
    elements?: {
      type: string;
      geometry?: { lat: number; lon: number }[];
      tags?: Record<string, string>;
    }[];
  };

  const buildings: BuildingFootprint[] = [];
  let truncated = false;
  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !el.geometry) continue;
    const ring: [number, number][] = el.geometry.map((g) => [g.lon, g.lat]);
    if (ring.length >= 2) {
      const a = ring[0];
      const b = ring[ring.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) ring.pop();
    }
    if (ring.length < 3) continue;
    buildings.push({
      ring,
      heightM: num(el.tags?.height),
      levels: num(el.tags?.["building:levels"]),
    });
    if (buildings.length >= opts.maxBuildings) {
      truncated = true;
      break;
    }
  }
  return { buildings, truncated };
}

export interface BuildingContext {
  west: number;
  south: number;
  east: number;
  north: number;
  /** Printed width (mm) of the terrain footprint (model X extent). */
  widthMm: number;
  /** Printed depth (mm) of the terrain footprint (model Y extent). */
  heightMm: number;
  /** Vertical scale: model mm per ground metre. */
  metresToMm: number;
  /** Extra multiplier on building heights. */
  heightScale: number;
  metresPerLevel: number;
  defaultHeightM: number;
  /** Terrain surface height (model Z, mm) at a model point. */
  groundZ: (xMm: number, yMm: number) => number;
}

export interface BuildingPart {
  name: string;
  color: RGB;
  z0: number;
  z1: number;
  positions: TriangleSoup;
}

/** Sink the flat base slightly into the terrain so it never floats. */
const EMBED_MM = 0.6;

/** [lng, lat] -> model (xMm, yMm); row 0 is north (max Y), matching the grid. */
function makeProjector(ctx: BuildingContext): (lng: number, lat: number) => [number, number] {
  const z = 20;
  const yN = latToTileY(ctx.north, z);
  const yS = latToTileY(ctx.south, z);
  const dY = yS - yN || 1e-9;
  const dLng = ctx.east - ctx.west || 1e-9;
  return (lng: number, lat: number): [number, number] => [
    ((lng - ctx.west) / dLng) * ctx.widthMm,
    ((yS - latToTileY(lat, z)) / dY) * ctx.heightMm,
  ];
}

function signedArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pushTri(
  out: TriangleSoup,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number
): void {
  out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
}

/** Watertight prism for one simple (hole-free) polygon between z0 and z1. */
function extrudePolygon(
  out: TriangleSoup,
  pts: [number, number][],
  z0: number,
  z1: number
): void {
  // Normalize to CCW so earcut's triangles have an upward (+Z) normal.
  const ring = signedArea(pts) < 0 ? [...pts].reverse() : pts;
  const flat: number[] = [];
  for (const [x, y] of ring) flat.push(x, y);
  const tris = earcut(flat);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = ring[tris[i]];
    const b = ring[tris[i + 1]];
    const c = ring[tris[i + 2]];
    // top cap (CCW) + bottom cap (reversed)
    pushTri(out, a[0], a[1], z1, b[0], b[1], z1, c[0], c[1], z1);
    pushTri(out, a[0], a[1], z0, c[0], c[1], z0, b[0], b[1], z0);
  }
  // outward side walls, one quad per ring edge
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    pushTri(out, p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1);
    pushTri(out, p[0], p[1], z0, q[0], q[1], z1, p[0], p[1], z1);
  }
}

/**
 * Extrude OSM footprints into a single "Buildings" part. Each building is a
 * closed prism sitting on the terrain (flat base at the lowest ground height
 * under its footprint, so it is never floating).
 */
export function buildBuildingParts(
  buildings: BuildingFootprint[],
  ctx: BuildingContext,
  color: RGB
): BuildingPart[] {
  const proj = makeProjector(ctx);
  const out: TriangleSoup = [];
  let z0 = Infinity;
  let z1 = -Infinity;

  for (const b of buildings) {
    const pts = b.ring.map(([lng, lat]) => proj(lng, lat));
    if (pts.length < 3 || Math.abs(signedArea(pts)) < 1e-6) continue;

    // Ground: lowest surface height under the footprint (flat base).
    let base = Infinity;
    for (const [x, y] of pts) base = Math.min(base, ctx.groundZ(x, y));
    if (!isFinite(base)) continue;

    const bottom = base - EMBED_MM;
    const top =
      base +
      buildingHeight(b, ctx.metresPerLevel, ctx.defaultHeightM) *
        ctx.metresToMm *
        ctx.heightScale;
    if (top <= bottom + 1e-6) continue;

    extrudePolygon(out, pts, bottom, top);
    if (bottom < z0) z0 = bottom;
    if (top > z1) z1 = top;
  }

  if (out.length === 0) return [];
  return [{ name: "Buildings", color, z0, z1, positions: out }];
}

