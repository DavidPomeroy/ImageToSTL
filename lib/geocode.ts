// Place-name search via OpenStreetMap's Nominatim geocoder.
//
// Nominatim is CORS-enabled (Access-Control-Allow-Origin: *), keyless and free.
// Its usage policy — interactive, low-volume lookups only (no bulk geocoding) —
// is satisfied by a search box. Attribution: © OpenStreetMap contributors.

export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export async function searchPlaces(
  query: string,
  limit = 6,
  signal?: AbortSignal
): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url =
    `${ENDPOINT}?format=jsonv2&limit=${Math.max(1, Math.min(10, limit))}` +
    `&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as {
    lat: string;
    lon: string;
    display_name?: string;
    name?: string;
  }[];
  return json.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lon),
    label: r.display_name || r.name || `${r.lat}, ${r.lon}`,
  }));
}
