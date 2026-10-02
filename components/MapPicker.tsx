"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { bboxFromCenter, type LatLng } from "@/lib/geo";
import { searchPlaces, type GeoResult } from "@/lib/geocode";

export interface MapSelection {
  center: LatLng;
  widthM: number;
  heightM: number;
}

/**
 * Leaflet map for picking a print area. The selection is a rectangle defined by
 * its centre + ground size; clicking the map moves the centre. A search box
 * (Nominatim geocoding) and a "use my location" button fly the map to a place.
 * Driven imperatively (like Preview3D drives three) to avoid an extra dep.
 */
export default function MapPicker({
  selection,
  onCenterChange,
  flyTo,
  flyNonce = 0,
}: {
  selection: MapSelection;
  onCenterChange: (c: LatLng) => void;
  /** When `flyNonce` changes, the map centres on this point. */
  flyTo?: LatLng | null;
  flyNonce?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const stateRef = useRef({ selection, onCenterChange });
  stateRef.current = { selection, onCenterChange };

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = el.current;
    if (!node || mapRef.current) return;
    const start = stateRef.current.selection.center;
    const map = L.map(node, {
      center: [start.lat, start.lng],
      zoom: 11,
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      stateRef.current.onCenterChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      rectRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { center, widthM, heightM } = selection;
    const bb = bboxFromCenter(center, widthM, heightM);
    const bounds = L.latLngBounds([bb.south, bb.west], [bb.north, bb.east]);
    if (rectRef.current) rectRef.current.setBounds(bounds);
    else
      rectRef.current = L.rectangle(bounds, {
        color: "#34d399",
        weight: 2,
        fillOpacity: 0.08,
      }).addTo(map);
  }, [selection]);

  // Fly to an externally-chosen point (geolocation / search).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.setView([flyTo.lat, flyTo.lng], Math.max(map.getZoom(), 12));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyNonce]);

  const goto = (p: LatLng) => {
    const map = mapRef.current;
    if (map) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 12));
    onCenterChange(p);
  };

  const doSearch = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const r = await searchPlaces(query, 6);
      if (r.length === 0) setError("No matches found.");
      setResults(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setError("Geolocation isn't available.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        goto({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setError("Couldn't get your location.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 }
    );
  };

  return (
    <div className="relative">
      <div
        ref={el}
        className="h-80 w-full overflow-hidden rounded-xl border border-zinc-800"
      />
      <div className="absolute left-2 right-2 top-2 z-[1000] space-y-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void doSearch();
          }}
          className="flex gap-1"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a place…"
            aria-label="Search for a place"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950/90 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            {searching ? "…" : "Search"}
          </button>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            title="Use my location"
            aria-label="Use my location"
            className="rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {locating ? "…" : "◎"}
          </button>
        </form>

        {results.length > 0 && (
          <ul className="max-h-40 overflow-auto rounded-lg border border-zinc-700 bg-zinc-950/95 text-sm shadow-lg">
            {results.map((r, i) => (
              <li key={i} className="border-b border-zinc-800 last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    goto(r);
                    setResults([]);
                    setQuery(r.label.split(",").slice(0, 2).join(","));
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-800"
                  title={r.label}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs leading-relaxed text-amber-300/90">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

