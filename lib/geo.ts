// Web-Mercator tile math for the map-based terrain source.
//
// Everything here is pure and framework-free (no DOM, no network) so it can be
// unit tested in Node. The map picker and the terrarium tile fetcher both build
// on these helpers.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const TILE_SIZE = 256;
/** The AWS/Mapzen terrarium tiles stop at zoom 15. */
export const MAX_TERRAIN_ZOOM = 15;
/** Web-Mercator latitude cutoff (the projection is undefined at the poles). */
export const MAX_MERCATOR_LAT = 85.05112878;

const DEG2RAD = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fractional tile x for a longitude at zoom z (0 .. 2^z). */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * Math.pow(2, z);
}

/** Fractional tile y for a latitude at zoom z (0 at the top). */
export function latToTileY(lat: number, z: number): number {
  const clamped = clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const rad = clamped * DEG2RAD;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    Math.pow(2, z)
  );
}

/** Longitude at (fractional) tile x. Inverse of lngToTileX. */
export function tileXToLng(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

/** Latitude at (fractional) tile y. Inverse of latToTileY. */
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / Math.pow(2, z));
  return Math.atan(Math.sinh(n)) / DEG2RAD;
}

/**
 * Ground size (metres) of a lat/lng bbox at its centre latitude. Longitude
 * degrees shrink with latitude; latitude degrees are ~constant.
 */
export function groundSizeMeters(bbox: BBox): {
  widthM: number;
  heightM: number;
} {
  const midLat = ((bbox.north + bbox.south) / 2) * DEG2RAD;
  const widthM = (bbox.east - bbox.west) * 111320 * Math.cos(midLat);
  const heightM = (bbox.north - bbox.south) * 110540;
  return {
    widthM: Math.max(1, Math.abs(widthM)),
    heightM: Math.max(1, Math.abs(heightM)),
  };
}

/**
 * Tile zoom that renders the bbox close to `targetPx` pixels across its width
 * (clamped to the terrarium range 1..15).
 */
export function zoomForTargetPixels(bbox: BBox, targetPx: number): number {
  const spanLng = Math.max(1e-6, Math.abs(bbox.east - bbox.west));
  const zf = Math.log2((targetPx * 360) / (spanLng * TILE_SIZE));
  return clamp(Math.round(zf), 1, MAX_TERRAIN_ZOOM);
}

export interface TileRange {
  /** Inclusive minimum tile index. */
  x0: number;
  y0: number;
  /** Exclusive maximum tile index. */
  x1: number;
  y1: number;
  nx: number;
  ny: number;
}

/** Tiles covering a bbox at zoom z (y grows southward). */
export function tileRangeForBbox(bbox: BBox, z: number): TileRange {
  const n = Math.pow(2, z);
  const clx = (v: number) => clamp(Math.floor(v), 0, n - 1);
  const cly = (v: number) => clamp(Math.floor(v), 0, n - 1);
  const x0 = clx(lngToTileX(bbox.west, z));
  const y0 = cly(latToTileY(bbox.north, z));
  const x1 = clx(lngToTileX(bbox.east, z) - 1e-9) + 1;
  const y1 = cly(latToTileY(bbox.south, z) - 1e-9) + 1;
  return { x0, y0, x1, y1, nx: Math.max(1, x1 - x0), ny: Math.max(1, y1 - y0) };
}

/** A bbox centred on `center` with the given ground dimensions (metres). */
export function bboxFromCenter(
  center: LatLng,
  widthM: number,
  heightM: number
): BBox {
  const halfLat = heightM / 2 / 110540;
  const lngScale = 111320 * Math.cos(center.lat * DEG2RAD);
  const halfLng = widthM / 2 / Math.max(1, lngScale);
  return {
    west: center.lng - halfLng,
    east: center.lng + halfLng,
    south: center.lat - halfLat,
    north: center.lat + halfLat,
  };
}

/**
 * Output grid dimensions so the printed tile keeps the selection's ground
 * aspect ratio, with the longer side at `targetPx` pixels.
 */
export function gridForBbox(
  bbox: BBox,
  targetPx: number
): { gw: number; gh: number } {
  const { widthM, heightM } = groundSizeMeters(bbox);
  const aspect = widthM / heightM;
  if (aspect >= 1) {
    return { gw: targetPx, gh: Math.max(2, Math.round(targetPx / aspect)) };
  }
  return { gh: targetPx, gw: Math.max(2, Math.round(targetPx * aspect)) };
}
