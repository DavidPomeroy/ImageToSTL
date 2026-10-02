"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolNav from "@/components/ToolNav";
import Dropzone from "@/components/Dropzone";
import TerrainControls, {
  DEFAULT_BAND_COLORS,
  type TerrainControlValues,
} from "@/components/TerrainControls";
import { Spinner } from "@/components/Spinner";
import { build3MF, buildSTL, buildSTLZip } from "@/lib/exporters";
import { downscaleImageData } from "@/lib/pipeline";
import {
  buildTerrainFromHeights,
  makeGroundSampler,
  normFromElevations,
  normFromImage,
  type TerrainOpts,
  type TerrainResult,
} from "@/lib/terrain";
import {
  buildBuildingParts,
  fetchBuildings,
  type BuildingFootprint,
  type BuildingPart,
} from "@/lib/buildings";
import {
  NATIVE_PX,
  fetchElevationRaster,
  resampleElevations,
  type ElevationRaster,
} from "@/lib/terrainTiles";
import { bboxFromCenter, type LatLng } from "@/lib/geo";

const MapPicker = dynamic(() => import("@/components/MapPicker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-80 w-full items-center justify-center rounded-xl border border-zinc-800 text-sm text-zinc-500">
      Loading map…
    </div>
  ),
});

const PreviewGeneric = dynamic(() => import("@/components/PreviewGeneric"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
      Loading 3D preview…
    </div>
  ),
});

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

const DEFAULT_CFG: TerrainControlValues = {
  source: "map",
  resolution: 160,
  widthMm: 120,
  reliefMm: 25,
  baseMm: 1.5,
  seaLevelPct: 0,
  invert: false,
  autoLevel: true,
  layerHeight: 0.2,
  bands: 1,
  bandColors: DEFAULT_BAND_COLORS.slice(),
  color: [176, 155, 96],
  frameEnabled: false,
  frameWidthMm: 3,
  frameColor: [60, 60, 60],
  mapWidthM: 4000,
  mapHeightM: 4000,
  buildings: false,
  metresPerLevel: 3,
  buildingHeightScale: 1,
  buildingColor: [130, 130, 135],
};

/**
 * The live 3D preview is meshed at this grid size at most; the full-resolution
 * model is only built when you download. Keeps interaction smooth.
 */
const PREVIEW_MAX = 128;

export default function TerrainPage() {
  const [cfg, setCfg] = useState<TerrainControlValues>(DEFAULT_CFG);
  const patch = useCallback(
    (p: Partial<TerrainControlValues>) => setCfg((c) => ({ ...c, ...p })),
    []
  );

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState("heightmap");
  const [mapCenter, setMapCenter] = useState<LatLng>({
    lat: 45.9766,
    lng: 7.6585,
  }); // Matterhorn

  const [raster, setRaster] = useState<ElevationRaster | null>(null);
  const [rasterBusy, setRasterBusy] = useState(false);
  const [rasterError, setRasterError] = useState<string | null>(null);

  const [result, setResult] = useState<TerrainResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState<"3mf" | "stl" | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  const buildRun = useRef(0);
  const mapRun = useRef(0);
  const locatedRef = useRef(false);

  // OSM buildings (map source)
  const [buildings, setBuildings] = useState<BuildingFootprint[]>([]);
  const [buildingParts, setBuildingParts] = useState<BuildingPart[]>([]);
  const [buildingsBusy, setBuildingsBusy] = useState(false);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);
  const [buildingsNote, setBuildingsNote] = useState<string | null>(null);
  const buildingRun = useRef(0);
  const buildingsCache = useRef<{
    key: string;
    data: BuildingFootprint[];
  } | null>(null);

  // Geolocation default + "fly the map here" signal for the picker.
  const [geoDone, setGeoDone] = useState(false);
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);
  const [flyNonce, setFlyNonce] = useState(0);
  const [locStatus, setLocStatus] = useState<string | null>(null);

  const debCfg = useDebouncedValue(cfg, 250);
  const selection = useMemo(
    () => ({ center: mapCenter, w: cfg.mapWidthM, h: cfg.mapHeightM }),
    [mapCenter, cfg.mapWidthM, cfg.mapHeightM]
  );
  const debSel = useDebouncedValue(selection, 350);

  const onFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setImageName(file.name.replace(/\.[^.]+$/, "") || "heightmap");
      setFitNonce((n) => n + 1);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, []);

  // Terrain builder options from any cfg snapshot.
  const terrainOpts = useCallback(
    (c: TerrainControlValues): TerrainOpts => ({
      widthMm: c.widthMm,
      reliefMm: c.reliefMm,
      baseMm: c.baseMm,
      layerHeight: c.layerHeight,
      seaLevelNorm: c.seaLevelPct / 100,
      color: c.color,
      bands: c.bands,
      bandColors: c.bandColors,
      frame: c.frameEnabled
        ? { widthMm: c.frameWidthMm, color: c.frameColor }
        : null,
    }),
    []
  );

  // Normalized elevation grid for a chosen output size, independent of the live
  // preview size (so the export can rebuild the same source at full resolution).
  const normFor = useCallback(
    (res: number): { norm: Float32Array; gw: number; gh: number } | null => {
      if (debCfg.source === "upload") {
        if (!image) return null;
        const id = downscaleImageData(image, res);
        const r = normFromImage(id, {
          invert: debCfg.invert,
          autoLevel: debCfg.autoLevel,
        });
        return { norm: r.norm, gw: r.gw, gh: r.gh };
      }
      if (!raster) return null;
      const aspect = raster.gw / raster.gh;
      const gw = aspect >= 1 ? res : Math.max(2, Math.round(res * aspect));
      const gh = aspect >= 1 ? Math.max(2, Math.round(res / aspect)) : res;
      const elev = resampleElevations(
        raster.elevations,
        raster.gw,
        raster.gh,
        gw,
        gh
      );
      let minM = Infinity;
      let maxM = -Infinity;
      for (let i = 0; i < elev.length; i++) {
        const v = elev[i];
        if (v < minM) minM = v;
        if (v > maxM) maxM = v;
      }
      if (!isFinite(minM)) {
        minM = 0;
        maxM = 0;
      }
      return { norm: normFromElevations(elev, minM, maxM), gw, gh };
    },
    [debCfg.source, debCfg.invert, debCfg.autoLevel, image, raster]
  );

  // Default the selection to the user's location once, on first load.
  useEffect(() => {
    if (locatedRef.current) return;
    locatedRef.current = true;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoDone(true);
      return;
    }
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        setGeoDone(true);
      }
    };
    const timer = setTimeout(finish, 9000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMapCenter(c);
        setFlyTo(c);
        setFlyNonce((n) => n + 1);
        setLocStatus("Centred on your location — click the map or search to move it.");
        finish();
      },
      () => {
        setLocStatus("Location unavailable — showing a default area.");
        finish();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 }
    );
    return () => clearTimeout(timer);
  }, []);

  // Fetch elevation tiles whenever the map selection (or resolution) settles.
  useEffect(() => {
    if (debCfg.source !== "map" || !geoDone) return;
    const bbox = bboxFromCenter(debSel.center, debSel.w, debSel.h);
    const runId = ++mapRun.current;
    setRasterBusy(true);
    setRasterError(null);
    fetchElevationRaster(bbox, NATIVE_PX)
      .then((r) => {
        if (mapRun.current === runId) setRaster(r);
      })
      .catch((e: unknown) => {
        if (mapRun.current !== runId) return;
        setRaster(null);
        setRasterError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (mapRun.current === runId) setRasterBusy(false);
      });
  }, [debCfg.source, debSel, geoDone]);

  // Fetch OSM buildings for the current selection (cached per bbox).
  useEffect(() => {
    if (debCfg.source !== "map" || !geoDone || !debCfg.buildings) return;
    const bbox = bboxFromCenter(debSel.center, debSel.w, debSel.h);
    const key = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
    if (buildingsCache.current?.key === key) {
      setBuildings(buildingsCache.current.data);
      setBuildingsNote(`${buildingsCache.current.data.length} buildings`);
      return;
    }
    const runId = ++buildingRun.current;
    setBuildingsBusy(true);
    setBuildingsError(null);
    setBuildingsNote(null);
    fetchBuildings(bbox, {
      metresPerLevel: debCfg.metresPerLevel,
      defaultHeightM: 10,
      maxBuildings: 900,
    })
      .then((res) => {
        if (buildingRun.current !== runId) return;
        buildingsCache.current = { key, data: res.buildings };
        setBuildings(res.buildings);
        setBuildingsNote(
          res.truncated
            ? `${res.buildings.length}+ buildings (capped — zoom in for the rest)`
            : `${res.buildings.length} buildings`
        );
      })
      .catch((e: unknown) => {
        if (buildingRun.current !== runId) return;
        setBuildings([]);
        setBuildingsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (buildingRun.current === runId) setBuildingsBusy(false);
      });
  }, [debCfg.source, debCfg.buildings, debSel, geoDone]);

  // Extrude the fetched footprints onto a given terrain grid.
  const makeBuildingParts = useCallback(
    (src: { norm: Float32Array; gw: number; gh: number }, opts: TerrainOpts) => {
      if (debCfg.source !== "map" || !debCfg.buildings) return [] as BuildingPart[];
      if (buildings.length === 0 || !raster) return [] as BuildingPart[];
      const relief = raster.maxM - raster.minM;
      if (relief < 1e-3) return [] as BuildingPart[];
      const bbox = bboxFromCenter(debSel.center, debSel.w, debSel.h);
      const pixelSize = debCfg.widthMm / src.gw;
      return buildBuildingParts(
        buildings,
        {
          west: bbox.west,
          south: bbox.south,
          east: bbox.east,
          north: bbox.north,
          widthMm: debCfg.widthMm,
          heightMm: src.gh * pixelSize,
          metresToMm: debCfg.reliefMm / relief,
          heightScale: debCfg.buildingHeightScale,
          metresPerLevel: debCfg.metresPerLevel,
          defaultHeightM: 10,
          groundZ: makeGroundSampler(src.norm, src.gw, src.gh, pixelSize, opts),
        },
        debCfg.buildingColor
      );
    },
    [debCfg, buildings, raster, debSel]
  );


  // Rebuild the preview model whenever the source data or settings settle.
  // Meshed at a capped resolution so dragging sliders stays smooth; the export
  // builds the full-resolution model on demand.
  useEffect(() => {
    const runId = ++buildRun.current;
    const src = normFor(Math.min(debCfg.resolution, PREVIEW_MAX));

    if (!src) {
      setResult(null);
      setBuildingParts([]);
      setProcessing(false);
      return;
    }

    setProcessing(true);
    const workTimer = setTimeout(() => {
      if (buildRun.current !== runId) return;
      try {
        const opts = terrainOpts(debCfg);
        const r = buildTerrainFromHeights(src.norm, src.gw, src.gh, opts);
        const bp = makeBuildingParts(src, opts);
        if (buildRun.current !== runId) return;
        setResult(r);
        setBuildingParts(bp);
        setFitNonce((n) => n + 1);
      } finally {
        if (buildRun.current === runId) setProcessing(false);
      }
    }, 60);

    return () => clearTimeout(workTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debCfg, normFor, terrainOpts, makeBuildingParts]);

  const previewParts = useMemo(
    () => [...(result?.parts ?? []), ...buildingParts],
    [result, buildingParts]
  );

  const parts = useMemo(
    () =>
      previewParts
        .filter((p) => p.positions.length > 0)
        .map((p) => ({
          name: p.name,
          color: p.color,
          positions: p.positions,
        })),
    [previewParts]
  );

  const fileBase = useMemo(() => {
    if (debCfg.source === "map") {
      return `terrain-${mapCenter.lat.toFixed(3)}_${mapCenter.lng.toFixed(3)}`;
    }
    return `${imageName}-terrain`;
  }, [debCfg.source, mapCenter, imageName]);

  // Vertical exaggeration: printed relief vs. the ground's true scale.
  const exaggeration = useMemo(() => {
    if (debCfg.source !== "map" || !raster) return null;
    const realRelief = raster.maxM - raster.minM;
    if (realRelief < 1e-3 || raster.groundWidthM < 1) return null;
    return (debCfg.reliefMm * raster.groundWidthM) /
      (debCfg.widthMm * realRelief);
  }, [debCfg.source, debCfg.reliefMm, debCfg.widthMm, raster]);

  // Full-resolution model, built on demand for export (the preview is capped).
  const buildFullParts = useCallback(() => {
    const src = normFor(debCfg.resolution);
    if (!src) return [];
    const opts = terrainOpts(debCfg);
    const full = buildTerrainFromHeights(src.norm, src.gw, src.gh, opts);
    const all = [...full.parts, ...makeBuildingParts(src, opts)];
    return all
      .filter((p) => p.positions.length > 0)
      .map((p) => ({
        name: p.name,
        color: p.color,
        positions: p.positions,
      }));
  }, [normFor, terrainOpts, debCfg, makeBuildingParts]);

  const download3MF = useCallback(async () => {
    if (busy || processing) return;
    setBusy("3mf");
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the button paint
      const exportParts = buildFullParts();
      if (exportParts.length === 0) return;
      saveBlob(await build3MF(exportParts), `${fileBase}.3mf`);
    } finally {
      setBusy(null);
    }
  }, [busy, processing, buildFullParts, fileBase]);

  const downloadSTLs = useCallback(async () => {
    if (busy || processing) return;
    setBusy("stl");
    try {
      await new Promise((r) => setTimeout(r, 30));
      const exportParts = buildFullParts();
      if (exportParts.length === 0) return;
      if (exportParts.length === 1) {
        saveBlob(new Blob([buildSTL(exportParts[0].positions)]), `${fileBase}.stl`);
      } else {
        saveBlob(await buildSTLZip(exportParts), `${fileBase}-stls.zip`);
      }
    } finally {
      setBusy(null);
    }
  }, [busy, processing, buildFullParts, fileBase]);

  // 2D relief preview (grayscale: low = dark, high = light).
  const preview2d = useMemo(() => {
    if (typeof document === "undefined" || !result) return null;
    const { gw, gh, norm } = result;
    const scale = Math.min(1, 480 / gw);
    const w = Math.max(1, Math.round(gw * scale));
    const h = Math.max(1, Math.round(gh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(gw - 1, Math.floor(x / scale));
        const sy = Math.min(gh - 1, Math.floor(y / scale));
        const v = Math.round(40 + Math.max(0, Math.min(1, norm[sy * gw + sx])) * 215);
        const o = (y * w + x) * 4;
        img.data[o] = v;
        img.data[o + 1] = v;
        img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [result]);


  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <ToolNav active="/terrain" />
          <h1 className="text-3xl font-bold tracking-tight">
            Heightmap <span className="text-zinc-500">→</span> 3D Terrain{" "}
            <span className="ml-2 inline-block rounded-full border border-amber-400/40 bg-amber-400/15 px-2.5 py-1 align-middle text-xs font-semibold uppercase tracking-wide text-amber-300">
              Experimental
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Pick a place on the map (or upload a heightmap) and turn the relief
            into a solid, printable tile — solid base, optional raised frame and
            elevation colour bands. Exports as 3MF or STL, ready for Bambu
            Studio or PrusaSlicer.
          </p>
          <p className="mt-2 max-w-2xl rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
            This tool is experimental and may not work as expected — elevation
            data, map tiles, and building footprints depend on third-party
            services that can be slow or unavailable.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  {cfg.source === "map" ? "1 · Pick location" : "1 · Upload heightmap"}
                </h2>
                {rasterBusy && <Spinner label="Loading tiles…" />}
              </div>
              {cfg.source === "map" ? (
                <>
                  <MapPicker
                    selection={{
                      center: mapCenter,
                      widthM: cfg.mapWidthM,
                      heightM: cfg.mapHeightM,
                    }}
                    onCenterChange={setMapCenter}
                    flyTo={flyTo}
                    flyNonce={flyNonce}
                  />
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                    {locStatus ??
                      "Search a place or click the map to move the selection box. Adjust its size with the sliders below."}
                  </p>
                  {cfg.buildings && (
                    <p
                      className={`mt-1 text-xs leading-relaxed ${
                        buildingsError ? "text-amber-300/90" : "text-zinc-500"
                      }`}
                    >
                      {buildingsBusy
                        ? "Loading OpenStreetMap buildings…"
                        : buildingsError
                          ? buildingsError
                          : (buildingsNote ?? "")}
                    </p>
                  )}

                </>
              ) : (
                <Dropzone onFile={onFile} fileName={image ? imageName : null} />
              )}
              {rasterError && (
                <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-300/90">
                  {rasterError}
                </p>
              )}
              {cfg.source === "map" && raster && (
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  Zoom {raster.zoom} · {raster.tileCount} tile(s) ·{" "}
                  {(raster.groundWidthM / 1000).toFixed(2)} ×{" "}
                  {(raster.groundHeightM / 1000).toFixed(2)} km · elevation{" "}
                  {raster.minM.toFixed(0)}–{raster.maxM.toFixed(0)} m
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  2 · Terrain settings
                </h2>
                {processing && <Spinner label="Updating…" />}
              </div>
              <TerrainControls v={cfg} onChange={patch} />
            </section>

            <p className="text-xs leading-relaxed text-zinc-600">
              Map ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                className="underline hover:text-zinc-400"
              >
                OpenStreetMap
              </a>{" "}
              contributors. Elevation from Mapzen / AWS Terrain Tiles (SRTM, 3DEP
              &amp; others). Attribution is required.
            </p>
          </aside>

          <section>


            {result && parts.length > 0 ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="border-b border-zinc-800 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                        Relief (2D)
                      </h3>
                    </div>
                    {preview2d && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview2d}
                        alt="Terrain relief preview"
                        className="w-full"
                      />
                    )}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                        3D preview
                      </h3>
                      <button
                        type="button"
                        onClick={() => setFitNonce((n) => n + 1)}
                        className="text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        Reset view
                      </button>
                    </div>
                    <div className="relative h-96 bg-zinc-950">
                      <PreviewGeneric
                        parts={previewParts}
                        bboxMm={result.bboxMm}
                        centerMm={result.centerMm}
                        fitNonce={fitNonce}
                      />
                    </div>
                  </div>
                </div>

                {result.warnings.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {result.warnings.map((w, i) => (
                      <p
                        key={i}
                        className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-300/90"
                      >
                        {w}
                      </p>
                    ))}
                  </div>
                )}


                <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums text-zinc-400">
                    <span>
                      Size: {result.widthMm.toFixed(0)} x{" "}
                      {result.heightMm.toFixed(0)} x{" "}
                      {result.maxHeightMm.toFixed(1)} mm
                    </span>
                    <span>
                      Triangles:{" "}
                      {Math.round(result.triangleCount).toLocaleString()}
                    </span>
                    <span>
                      Parts: {parts.length}
                      {parts.length > 1 ? " (one extruder each)" : ""}
                    </span>
                    {debCfg.buildings && (
                      <span>Buildings: {buildings.length}</span>
                    )}
                    <span>
                      Preview: {result.gw} px
                      {debCfg.resolution > PREVIEW_MAX
                        ? ` · export at ${debCfg.resolution} px`
                        : ""}
                    </span>
                    {exaggeration !== null && (
                      <span>
                        Vertical exaggeration: {exaggeration.toFixed(2)}×
                      </span>
                    )}
                  </div>
                  <p className="mb-4 max-w-2xl text-xs leading-relaxed text-zinc-500">
                    The 3MF bundles every part with its filament colour: open it
                    in Bambu Studio / PrusaSlicer, import as one object with
                    multiple parts, and assign an extruder to each. Or grab the
                    STL{parts.length > 1 ? " zip" : ""} and import aligned at the
                    origin.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={download3MF}
                      disabled={busy !== null || processing}
                      className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "3mf"
                        ? "Building 3MF…"
                        : processing
                          ? "Updating model…"
                          : `Download 3MF (${parts.length} part${parts.length > 1 ? "s" : ""})`}
                    </button>
                    <button
                      type="button"
                      onClick={downloadSTLs}
                      disabled={busy !== null || processing}
                      className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "stl"
                        ? "Building STL…"
                        : processing
                          ? "Updating model…"
                          : parts.length > 1
                            ? `Download STL zip (${parts.length} files)`
                            : "Download STL"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-96 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 text-center text-sm text-zinc-500">
                {cfg.source === "map"
                  ? rasterBusy
                    ? "Loading elevation tiles…"
                    : rasterError
                      ? "Couldn't load elevation tiles."
                      : "Pick an area on the map to build terrain."
                  : image
                    ? "Building terrain…"
                    : "Upload a heightmap image (PNG / JPG / WebP)."}
              </div>
            )}
          </section>
        </div>

        <footer className="mt-10 text-center text-xs text-zinc-600">
          Map tiles are fetched from OpenStreetMap and elevation from AWS Terrain
          Tiles — the other tools stay entirely local.
        </footer>
      </div>
    </main>
  );
}

