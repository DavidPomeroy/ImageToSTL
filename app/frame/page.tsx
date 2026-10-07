"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolNav from "@/components/ToolNav";
import FrameControls, {
  type FrameControlValues,
} from "@/components/FrameControls";
import { LoadingOverlay, Spinner } from "@/components/Spinner";
import { build3MF, buildSTL, buildSTLZip } from "@/lib/exporters";
import { buildFrame, type FrameResult } from "@/lib/frame";
import { curveRadius } from "@/lib/curve";
import { takeFramePrefill } from "@/lib/framePrefill";

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

const DEFAULT_CFG: FrameControlValues = {
  plateWidthMm: 100,
  plateHeightMm: 80,
  plateThicknessMm: 5,
  shapeType: "rectangle",
  shapeSize: 1,
  clearanceMm: 0.3,
  borderMm: 10,
  ledgeMm: 3,
  gapMm: 12,
  revealMm: 1,
  curveDeg: 0,
  retain: "rebate",
  lipMm: 2,
  lipOpenMm: 8,
  topStop: false,
  back: "panel",
  backMm: 2,
  channelWidthMm: 10,
  channelDepthMm: 1.5,
  wireHoleMm: 5,
  resolution: 300,
  color: [24, 24, 27],
};

/** 2D footprint preview: frame material, cavity and the plate window. */
function FramePreview2D({
  preview,
  gw,
  gh,
}: {
  preview: Uint8ClampedArray;
  gw: number;
  gh: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(gw, gh);
    img.data.set(preview);
    ctx.putImageData(img, 0, 0);
  }, [preview, gw, gh]);
  return (
    <canvas
      ref={ref}
      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 [image-rendering:pixelated]"
    />
  );
}

export default function FramePage() {
  const [cfg, setCfg] = useState<FrameControlValues>(DEFAULT_CFG);
  const patch = useCallback(
    (p: Partial<FrameControlValues>) => setCfg((c) => ({ ...c, ...p })),
    []
  );

  const [fitNonce, setFitNonce] = useState(0);
  const [busy, setBusy] = useState<"3mf" | "stl" | null>(null);
  const [result, setResult] = useState<FrameResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  /** Shape centre on the plate (0.5 = centred); set from the Image → 3D copy. */
  const [shapeCentre, setShapeCentre] = useState({ cx: 0.5, cy: 0.5 });

  // Pick up settings copied from the Image → 3D tool ("Copy settings to
  // Frame → 3D"), then clear the stash so a refresh opens with defaults.
  useEffect(() => {
    const p = takeFramePrefill();
    if (!p) return;
    setCfg((c) => ({
      ...c,
      shapeType: p.shapeType,
      shapeSize: p.shapeSize,
      plateWidthMm: p.plateWidthMm,
      plateHeightMm: p.plateHeightMm,
      plateThicknessMm: p.plateThicknessMm,
      curveDeg: p.curveDeg,
    }));
    setShapeCentre({ cx: p.shapeCx, cy: p.shapeCy });
  }, []);

  const debCfg = useDebouncedValue(cfg, 160);

  useEffect(() => {
    setProcessing(true);
    const id = setTimeout(() => setShowLoading(true), 250);
    const t = setTimeout(() => {
      try {
        const r = buildFrame({
          plateWidthMm: debCfg.plateWidthMm,
          plateHeightMm: debCfg.plateHeightMm,
          plateThicknessMm: debCfg.plateThicknessMm,
          shapeType: debCfg.shapeType,
          shapeCx: shapeCentre.cx,
          shapeCy: shapeCentre.cy,
          shapeSize: debCfg.shapeSize,
          clearanceMm: debCfg.clearanceMm,
          borderMm: debCfg.borderMm,
          ledgeMm: debCfg.ledgeMm,
          gapMm: debCfg.gapMm,
          revealMm: debCfg.revealMm,
          curveDeg: debCfg.curveDeg,
          retain: debCfg.retain,
          lipMm: debCfg.lipMm,
          lipOpenMm: debCfg.lipOpenMm,
          topStop: debCfg.topStop,
          back: debCfg.back,
          backMm: debCfg.backMm,
          channelWidthMm: debCfg.channelWidthMm,
          channelDepthMm: debCfg.channelDepthMm,
          wireHoleMm: debCfg.wireHoleMm,
          resolution: debCfg.resolution,
          color: debCfg.color,
        });
        setResult(r);
        setFitNonce((n) => n + 1);
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
  }, [debCfg, shapeCentre]);

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

  const fileBase = useMemo(
    () => `picture-frame-${cfg.shapeType}-${Math.round(cfg.plateWidthMm)}x${Math.round(cfg.plateHeightMm)}`,
    [cfg.shapeType, cfg.plateWidthMm, cfg.plateHeightMm]
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
          <ToolNav active="/frame" />
          <h1 className="text-3xl font-bold tracking-tight">
            Frame <span className="text-zinc-500">→</span> 3D Print
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Build a picture frame for a plate from the Image → 3D tool. The frame
            follows the plate&apos;s outline, the plate drops into a rebate, and a
            cavity behind it holds an LED strip or board. Exports 3MF / STL for
            Bambu Studio or PrusaSlicer.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Frame settings
                </h2>
                {processing && <Spinner label="Updating…" />}
              </div>
              <FrameControls v={cfg} onChange={patch} />
            </section>
          </aside>

          <section>
            {result && parts.length > 0 ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="border-b border-zinc-800 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                        Footprint (2D)
                      </h3>
                    </div>
                    <div className="bg-zinc-950 p-2">
                      <FramePreview2D
                        preview={result.preview}
                        gw={result.gw}
                        gh={result.gh}
                      />
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
                    <span>Air gap: {cfg.gapMm.toFixed(1)} mm</span>
                    {cfg.curveDeg > 0 && (
                      <span>
                        Bend radius:{" "}
                        {curveRadius(cfg.plateWidthMm, cfg.curveDeg).toFixed(0)} mm
                      </span>
                    )}
                    <span>
                      Triangles:{" "}
                      {Math.round(result.triangleCount).toLocaleString()}
                    </span>
                    <span>Parts: {parts.length}</span>
                  </div>
                  <p className="mb-4 max-w-2xl text-xs leading-relaxed text-zinc-500">
                    The frame is a tray: drop the plate into the rebate (front
                    side up) and lay the LED strip/board in the cavity behind it
                    before seating the plate. Import as one object and assign an
                    extruder to each part.
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
                Building…
              </div>
            )}
          </section>
        </div>

        <footer className="mt-10 text-center text-xs text-zinc-600">
          Runs entirely in your browser — nothing leaves your device.
        </footer>
      </div>
    </main>
  );
}

