"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import ToolNav from "@/components/ToolNav";
import Dropzone from "@/components/Dropzone";
import CoasterControls, {
  type CoasterControlValues,
} from "@/components/CoasterControls";
import PaletteEditor from "@/components/PaletteEditor";
import Preview2D from "@/components/Preview2D";
import { LoadingOverlay, Spinner } from "@/components/Spinner";
import { build3MF, buildSTL, buildSTLZip } from "@/lib/exporters";
import { downscaleImageData } from "@/lib/pipeline";
import { buildCoaster, type CoasterResult } from "@/lib/coaster";
import { autoPalette, collectPixels, type RGB } from "@/lib/quantize";

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

const DEFAULT_CFG: CoasterControlValues = {
  shape: "circle",
  sizeMm: 100,
  baseMm: 3,
  rimMm: 4,
  cornerMm: 10,
  mode: "mosaic",
  depthMm: 1,
  resolution: 300,
  baseColor: [24, 24, 27],
  colorCount: 4,
  reliefInvert: false,
};

export default function CoasterPage() {
  const [cfg, setCfg] = useState<CoasterControlValues>(DEFAULT_CFG);
  const patch = useCallback(
    (p: Partial<CoasterControlValues>) => setCfg((c) => ({ ...c, ...p })),
    []
  );

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState("coaster");
  const [palette, setPalette] = useState<RGB[]>([]);
  const [fitNonce, setFitNonce] = useState(0);
  const [busy, setBusy] = useState<"3mf" | "stl" | null>(null);
  const [result, setResult] = useState<CoasterResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showLoading, setShowLoading] = useState(false);

  const debRes = useDebouncedValue(cfg.resolution, 150);
  const debCfg = useDebouncedValue(cfg, 200);

  const onFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setImageName(file.name.replace(/\.[^.]+$/, "") || "coaster");
      setFitNonce((n) => n + 1);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, []);

  const imageData = useMemo(
    () => (image ? downscaleImageData(image, debRes) : null),
    [image, debRes]
  );

  useEffect(() => {
    if (!imageData) return;
    setPalette(autoPalette(collectPixels(imageData.data), cfg.colorCount));
  }, [imageData, cfg.colorCount]);

  const regeneratePalette = useCallback(() => {
    if (imageData) setPalette(autoPalette(collectPixels(imageData.data), cfg.colorCount));
  }, [imageData, cfg.colorCount]);

  useEffect(() => {
    if (!imageData || (debCfg.mode === "mosaic" && palette.length === 0)) {
      setResult(null);
      setProcessing(false);
      setShowLoading(false);
      return;
    }
    setProcessing(true);
    const id = setTimeout(() => setShowLoading(true), 250);
    const t = setTimeout(() => {
      try {
        const r = buildCoaster(imageData, {
          shape: debCfg.shape,
          sizeMm: debCfg.sizeMm,
          baseMm: debCfg.baseMm,
          rimMm: debCfg.rimMm,
          cornerMm: debCfg.cornerMm,
          mode: debCfg.mode,
          depthMm: debCfg.depthMm,
          resolution: debCfg.resolution,
          baseColor: debCfg.baseColor,
          palette,
          reliefInvert: debCfg.reliefInvert,
        });
        setResult(r);
      } catch (e) {
        console.error(e);
        setResult(null);
      } finally {
        setProcessing(false);
        setShowLoading(false);
        clearTimeout(id);
      }
    }, 40);
    return () => {
      clearTimeout(t);
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageData, palette, debCfg]);

  const parts = useMemo(
    () =>
      (result?.parts ?? [])
        .filter((p) => p.positions.length > 0)
        .map((p) => ({
          name: p.name,
          color: p.color,
          positions: p.positions,
        })),
    [result]
  );

  const counts = useMemo(() => {
    if (!result || result.mode !== "mosaic") return [];
    const c = new Array(palette.length).fill(0);
    for (const g of result.grid) if (g < palette.length) c[g]++;
    return c as number[];
  }, [result, palette.length]);

  const pixelArea = result ? result.pixelSizeMm ** 2 : 0;
  const fileBase = useMemo(
    () => `${imageName}-coaster-${cfg.shape}`,
    [imageName, cfg.shape]
  );

  const download3MF = useCallback(async () => {
    if (parts.length === 0 || busy) return;
    setBusy("3mf");
    try {
      saveBlob(await build3MF(parts), `${fileBase}.3mf`);
    } finally {
      setBusy(null);
    }
  }, [parts, busy, fileBase]);

  const downloadSTLs = useCallback(async () => {
    if (parts.length === 0 || busy) return;
    setBusy("stl");
    try {
      if (parts.length === 1) {
        saveBlob(new Blob([buildSTL(parts[0].positions)]), `${fileBase}.stl`);
      } else {
        saveBlob(await buildSTLZip(parts), `${fileBase}-stl.zip`);
      }
    } finally {
      setBusy(null);
    }
  }, [parts, busy, fileBase]);


  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <ToolNav active="/coaster" />
          <h1 className="text-3xl font-bold tracking-tight">
            Coaster <span className="text-zinc-500">→</span> 3D Print
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Turn an image into a round / hex / octagon / square coaster with a
            raised rim — a flat multi-colour mosaic or a single-filament relief.
            Exports 3MF or STL, ready for Bambu Studio or PrusaSlicer.
          </p>
          <p className="mt-2 max-w-2xl rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
            Material tip: PLA softens with heat and is not suitable for hot
            drinks — print coasters for hot mugs in PETG (or another
            heat-resistant filament) instead.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  1 · Upload image
                </h2>
                {processing && <Spinner label="Updating…" />}
              </div>
              <Dropzone onFile={onFile} fileName={image ? imageName : null} />
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                2 · Coaster
              </h2>
              <CoasterControls v={cfg} onChange={patch} />
            </section>

            {cfg.mode === "mosaic" && palette.length > 0 && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  3 · Colours
                </h2>
                <PaletteEditor
                  palette={palette}
                  counts={counts}
                  pixelArea={pixelArea}
                  onChange={(i, color) =>
                    setPalette((p) => p.map((c, k) => (k === i ? color : c)))
                  }
                  onAuto={regeneratePalette}
                />
              </section>
            )}
          </aside>

          <section>


            {result && parts.length > 0 ? (
              <>
                <div className="space-y-6">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="border-b border-zinc-800 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                        Preview (2D)
                      </h3>
                    </div>
                    <div className="flex items-center justify-center bg-zinc-950 p-2">
                      <div className="w-full max-w-md">
                        <Preview2D
                          grid={result.grid}
                          gw={result.gw}
                          gh={result.gh}
                          palette={palette}
                          heights={result.mode === "relief" ? result.relief : undefined}
                          hMin={0}
                          hMax={result.depthMm}
                        />
                      </div>
                    </div>
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
                        parts={result.parts}
                        bboxMm={result.bboxMm}
                        centerMm={result.centerMm}
                        fitNonce={fitNonce}
                      />
                      {showLoading && <LoadingOverlay title="Building…" />}
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
                      {result.heightMm.toFixed(0)} x {result.depthMm.toFixed(1)} mm
                    </span>
                    <span>
                      Triangles:{" "}
                      {Math.round(result.triangleCount).toLocaleString()}
                    </span>
                    <span>Parts: {parts.length}</span>
                  </div>
                  <p className="mb-4 max-w-2xl text-xs leading-relaxed text-zinc-500">
                    {result.mode === "mosaic"
                      ? "The 3MF bundles the base plus one part per colour. Import as one object with multiple parts and assign an extruder to each."
                      : "Single part — print in one filament. Slice with the relief side up."}
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
              <div className="flex h-96 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-500">
                {image ? "Building…" : "Upload an image to make a coaster."}
              </div>
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

