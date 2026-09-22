"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Dropzone from "@/components/Dropzone";
import Controls from "@/components/Controls";
import PaletteEditor from "@/components/PaletteEditor";
import Preview2D from "@/components/Preview2D";
import {
  downscaleImageData,
  meshPartPositions,
  processImageData,
  type PrintMode,
  type ProcessedImage,
} from "@/lib/pipeline";
import { autoPalette, collectPixels, type RGB } from "@/lib/quantize";
import { build3MF, buildSTL, buildSTLZip } from "@/lib/exporters";

const Preview3D = dynamic(() => import("@/components/Preview3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
      Loading 3D preview…
    </div>
  ),
});

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

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

export default function Home() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState("image");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<PrintMode>("mosaic");
  const [resolution, setResolution] = useState(120);
  const [widthMm, setWidthMm] = useState(100);
  const [depthMm, setDepthMm] = useState(5);
  const [layerHeight, setLayerHeight] = useState(0.2);
  const [minThickness, setMinThickness] = useState(0.8);
  const [colorLayers, setColorLayers] = useState(4);
  const [whiteMinLayers, setWhiteMinLayers] = useState(2);
  const [whiteMaxLayers, setWhiteMaxLayers] = useState(16);
  const [palette, setPalette] = useState<RGB[]>([]);
  const [fitNonce, setFitNonce] = useState(0);
  const [busy, setBusy] = useState<"3mf" | "stl" | null>(null);

  const debouncedResolution = useDebouncedValue(resolution, 150);

  const onFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setImageName(file.name.replace(/\.[^.]+$/, "") || "image");
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setFitNonce((n) => n + 1);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, []);

  const imageData = useMemo(
    () => (image ? downscaleImageData(image, debouncedResolution) : null),
    [image, debouncedResolution]
  );

  // auto-detect the 4 colors whenever the (downscaled) image changes
  useEffect(() => {
    if (!imageData) return;
    setPalette(autoPalette(collectPixels(imageData.data), 4));
  }, [imageData]);

  const regeneratePalette = useCallback(() => {
    if (imageData) setPalette(autoPalette(collectPixels(imageData.data), 4));
  }, [imageData]);

  const processed: ProcessedImage | null = useMemo(
    () =>
      imageData &&
      (mode === "lithophane" || mode === "cmyk" || palette.length > 0)
        ? processImageData(imageData, palette, widthMm, depthMm, mode, layerHeight, minThickness, {
            colorLayers,
            whiteMinLayers,
            whiteMaxLayers,
          })
        : null,
    [imageData, palette, widthMm, depthMm, mode, layerHeight, minThickness, colorLayers, whiteMinLayers, whiteMaxLayers]
  );

  const exportParts = useMemo(
    () =>
      processed
        ? meshPartPositions(processed).filter((p) => p.positions.length > 0)
        : [],
    [processed]
  );
  const hasGeometry = exportParts.length > 0;
  const fileBase =
    mode === "cmyk"
      ? `${imageName}-cmyk-lithophane`
      : mode === "lithophane"
        ? `${imageName}-lithophane`
        : `${imageName}-4color-${mode}`;

  const download3MF = useCallback(async () => {
    if (!hasGeometry) return;
    setBusy("3mf");
    try {
      saveBlob(await build3MF(exportParts), `${fileBase}.3mf`);
    } finally {
      setBusy(null);
    }
  }, [exportParts, hasGeometry, fileBase]);

  const downloadSTLs = useCallback(async () => {
    if (!hasGeometry) return;
    setBusy("stl");
    try {
      if (mode === "lithophane") {
        saveBlob(
          new Blob([buildSTL(exportParts[0].positions)]),
          `${fileBase}.stl`
        );
      } else {
        saveBlob(
          await buildSTLZip(exportParts),
          `${fileBase}-stls.zip`
        );
      }
    } finally {
      setBusy(null);
    }
  }, [exportParts, hasGeometry, fileBase]);

  const counts = processed ? processed.meshes.map((m) => m.pixelCount) : [];
  const pixelArea = processed ? processed.pixelSizeMm ** 2 : 0;
  const swapBands = processed ? processed.bands.slice(1) : [];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Image <span className="text-zinc-500">→</span> 4-Color 3D Print
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Upload an image and turn it into a 4-color, 5&nbsp;mm deep
            3D-printable plate — flat multi-material mosaic, HueForge-style
            layered relief, single-filament lithophane, or full-color CMYK
            lithophane. Exports as 3MF or STL, ready for Bambu Studio or
            PrusaSlicer. Everything runs locally in your browser.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                1 · Upload image
              </h2>
              <Dropzone onFile={onFile} fileName={image ? imageName : null} />
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                2 · Print settings
              </h2>
              <Controls
                mode={mode}
                resolution={resolution}
                widthMm={widthMm}
                depthMm={depthMm}
                layerHeight={layerHeight}
                minThickness={minThickness}
                colorLayers={colorLayers}
                whiteMinLayers={whiteMinLayers}
                whiteMaxLayers={whiteMaxLayers}
                onMode={setMode}
                onResolution={setResolution}
                onWidthMm={setWidthMm}
                onDepthMm={setDepthMm}
                onLayerHeight={setLayerHeight}
                onMinThickness={setMinThickness}
                onColorLayers={setColorLayers}
                onWhiteMinLayers={setWhiteMinLayers}
                onWhiteMaxLayers={setWhiteMaxLayers}
              />
              {processed && processed.pixelSizeMm < 0.4 && (
                <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
                  One pixel is {processed.pixelSizeMm.toFixed(2)}&nbsp;mm —
                  finer than a typical 0.4&nbsp;mm nozzle can reproduce. Lower
                  the resolution or increase the plate width for cleaner
                  prints.
                </p>
              )}
            </section>

            {processed && (mode === "mosaic" || mode === "layered") && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  {mode === "layered"
                    ? "3 · Filament stack (bottom → top)"
                    : "3 · Filament colors"}
                </h2>
                <PaletteEditor
                  palette={palette}
                  counts={counts}
                  pixelArea={pixelArea}
                  bands={processed.bands}
                  stacked={mode === "layered"}
                  onChange={(i, c) =>
                    setPalette((p) => {
                      const n = [...p];
                      n[i] = c;
                      return n;
                    })
                  }
                  onAuto={regeneratePalette}
                />
              </section>
            )}

            {processed && mode === "cmyk" && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  3 · Filaments (print order)
                </h2>
                <ul className="space-y-2">
                  {[
                    ["Cyan", "#00aeef", "color layer · bottom"],
                    ["Magenta", "#ec008c", "color layer"],
                    ["Yellow", "#fff200", "color layer"],
                    ["White", "#f5f5f0", "lithophane relief · top"],
                  ].map(([name, hex, role]) => (
                    <li
                      key={name}
                      className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                    >
                      <span
                        className="h-6 w-6 shrink-0 rounded-md border border-zinc-600"
                        style={{ backgroundColor: hex }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-zinc-200">
                          {name}
                        </div>
                        <div className="text-xs text-zinc-500">{role}</div>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                  Load the 4 filaments into your AMS/MMU and assign each part
                  to its matching extruder — the slicer handles all swaps.
                </p>
              </section>
            )}
          </aside>

          <section className="min-w-0 space-y-6">
            {!processed || !hasGeometry ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-10 text-center">
                <svg
                  className="mb-4 h-10 w-10 text-zinc-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Z"
                  />
                </svg>
                <h3 className="text-lg font-medium text-zinc-300">
                  No image yet
                </h3>
                <p className="mt-1 max-w-sm text-sm text-zinc-500">
                  Upload an image to generate a printable plate — flat
                  mosaic, HueForge-style relief, lithophane, or CMYK color
                  lithophane.
                </p>
                <ol className="mt-6 space-y-2 text-left text-sm text-zinc-500">
                  <li>
                    <span className="text-emerald-400">1 —</span> Drop in a
                    PNG/JPG (transparent areas become empty space)
                  </li>
                  <li>
                    <span className="text-emerald-400">2 —</span> It is shrunk
                    down and reduced to 4 filament colors
                  </li>
                  <li>
                    <span className="text-emerald-400">3 —</span> Download a 3MF
                    (or 4 STLs) and assign filaments in your slicer
                  </li>
                </ol>
              </div>
            ) : (
              <>
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                      Original · {image?.naturalWidth}×{image?.naturalHeight} px
                    </h3>
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt="Original upload"
                        className="w-full rounded-lg border border-zinc-800 [background:repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] [background-size:16px_16px]"
                      />
                    )}
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                      {processed.mode === "lithophane" || processed.mode === "cmyk" ? "Backlit preview" : "Quantized image"} · {processed.gw}×{processed.gh} px
                    </h3>
                    <Preview2D
                      grid={processed.grid}
                      gw={processed.gw}
                      gh={processed.gh}
                      palette={palette}
                      heights={processed.heights}
                      hMin={processed.minThicknessMm}
                      hMax={processed.depthMm}
                      cmykPreview={processed.cmykPreview}
                    />
                    <dl className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Plate size</dt>
                        <dd className="tabular-nums text-zinc-300">
                          {processed.widthMm.toFixed(0)} ×{" "}
                          {processed.heightMm.toFixed(1)} ×{" "}
                          {processed.depthMm.toFixed(1)} mm
                        </dd>
                      </div>
                      {processed.mode === "layered" && processed.bands.length > 0 && (
                        <div className="flex justify-between">
                          <dt className="text-zinc-500">Height range</dt>
                          <dd className="tabular-nums text-zinc-300">
                            {processed.bands[0].z1.toFixed(1)} –{" "}
                            {processed.depthMm.toFixed(1)} mm (relief)
                          </dd>
                        </div>
                      )}
                      {processed.mode === "lithophane" &&
                        processed.minThicknessMm !== undefined && (
                          <div className="flex justify-between">
                            <dt className="text-zinc-500">Thickness range</dt>
                            <dd className="tabular-nums text-zinc-300">
                              {processed.minThicknessMm.toFixed(1)} –{" "}
                              {processed.depthMm.toFixed(1)} mm
                            </dd>
                          </div>
                        )}
                      {processed.mode === "cmyk" && (
                        <div className="flex justify-between">
                          <dt className="text-zinc-500">Layers (max)</dt>
                          <dd className="tabular-nums text-zinc-300">
                            {Math.round(
                              processed.depthMm / processed.layerHeight
                            )}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Pixel size</dt>
                        <dd className="tabular-nums text-zinc-300">
                          {processed.pixelSizeMm.toFixed(2)} mm
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Pixels printed</dt>
                        <dd className="tabular-nums text-zinc-300">
                          {processed.filledPixels.toLocaleString()} /{" "}
                          {(processed.gw * processed.gh).toLocaleString()}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Triangles</dt>
                        <dd className="tabular-nums text-zinc-300">
                          {processed.triangleCount.toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="relative h-[500px] overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950">
                    <Preview3D processed={processed} fitNonce={fitNonce} />
                    <button
                      type="button"
                      onClick={() => setFitNonce((n) => n + 1)}
                      className="absolute right-3 top-3 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur transition-colors hover:bg-zinc-800"
                    >
                      Reset view
                    </button>
                    <span className="pointer-events-none absolute bottom-3 left-3 text-xs text-zinc-500">
                      Drag to orbit · scroll to zoom
                    </span>
                  </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                    {mode === "lithophane" ? "3" : "4"} · Export
                  </h3>
                  <p className="mb-4 max-w-2xl text-xs leading-relaxed text-zinc-500">
                    {processed.mode === "lithophane"
                      ? "One single-filament part: print flat with the relief side up, white or natural PLA, high infill (or several walls). Hold the print in front of a light — thin areas glow bright, thick areas stay dark."
                      : processed.mode === "cmyk"
                        ? "4 parts in print order — Cyan (bottom), Magenta, Yellow, then the White relief on top. Import the 3MF as one object with multiple parts (or all 4 STLs aligned at the origin) and assign each part its filament. Slice with the layer height you set, then backlight the print."
                        : "The 3MF bundles all 4 color parts with their filament colors: open it in Bambu Studio / PrusaSlicer, import as one object with multiple parts, and assign an extruder to each color. Or grab the STL zip and import all 4 files together, aligned at the origin."}
                  </p>
                  {processed.mode === "layered" && swapBands.length > 0 && (
                    <p className="mb-4 max-w-2xl rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs leading-relaxed text-emerald-300/90">
                      Slice at {processed.layerHeight}&nbsp;mm layer height
                      and swap filaments at z ={" "}
                      {swapBands.map((b) => b.z0.toFixed(1)).join(", ")}
                      &nbsp;mm (layers{" "}
                      {swapBands.map((b) => b.layer0).join(", ")}).
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={download3MF}
                      disabled={busy !== null}
                      className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "3mf"
                        ? "Building 3MF…"
                        : mode === "lithophane"
                          ? "Download 3MF"
                          : "Download 3MF (4 color parts)"}
                    </button>
                    <button
                      type="button"
                      onClick={downloadSTLs}
                      disabled={busy !== null}
                      className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "stl"
                        ? "Building STL…"
                        : mode === "lithophane"
                          ? "Download STL"
                          : "Download STL zip (4 files)"}
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                    Bambu Studio: on import, confirm the color-mapping dialog
                    (standard 3MF color import) to assign each part its
                    filament — parts also carry extruder metadata so the
                    mapping is pre-set. Meshes are manifold; no repair
                    prompts.
                  </p>
                </div>
              </>
            )}
          </section>
        </div>

        <footer className="mt-10 text-center text-xs text-zinc-600">
          Runs entirely in your browser — your images never leave your device.
        </footer>
      </div>
    </main>
  );
}
