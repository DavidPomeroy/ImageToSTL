"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import ToolNav from "@/components/ToolNav";
import BadgeControls, { type BadgeControlValues } from "@/components/BadgeControls";
import { LoadingOverlay, Spinner } from "@/components/Spinner";
import { TEXT_FONTS } from "@/components/TextControls";
import { build3MF, buildSTLZip } from "@/lib/exporters";
import { buildBadge, type BadgeResult } from "@/lib/badge";

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

/** Ensure a Google-Fonts stylesheet for the selected font is present. */
function useGoogleFont(importUrl: string | undefined) {
  const [ready, setReady] = useState(!importUrl);
  useEffect(() => {
    if (!importUrl) {
      setReady(true);
      return;
    }
    setReady(false);
    let link = document.querySelector<HTMLLinkElement>(
      `link[data-tfont="${importUrl}"]`
    );
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = importUrl;
      link.dataset.tfont = importUrl;
      document.head.appendChild(link);
    }
    let live = true;
    const url = importUrl;
    (async () => {
      try {
        const fam = new URL(url).searchParams.get("family") ?? "";
        const name = fam.split(":")[0].replace(/\+/g, " ");
        if (name && document.fonts) {
          await Promise.race([
            document.fonts.load(`100px "${name}"`),
            new Promise((r) => setTimeout(r, 3000)),
          ]);
        } else {
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch {
        /* fall through */
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [importUrl]);
  return ready;
}

const DEFAULT_CFG: BadgeControlValues = {
  text: "Alex",
  fontIdx: 0,
  customFamily: null,
  bold: true,
  italic: false,
  shape: "rounded",
  widthMm: 60,
  heightMm: 30,
  cornerMm: 6,
  plateMm: 3,
  textStyle: "raised",
  textMm: 1,
  textScale: 0.8,
  marginMm: 4,
  holeEnabled: true,
  holeMm: 5,
  holeInsetMm: 4,
  plateColor: [37, 99, 235],
  textColor: [245, 245, 245],
};

export default function BadgePage() {
  const [cfg, setCfg] = useState<BadgeControlValues>(DEFAULT_CFG);
  const patch = useCallback(
    (p: Partial<BadgeControlValues>) => setCfg((c) => ({ ...c, ...p })),
    []
  );
  const [fontLoading, setFontLoading] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [busy, setBusy] = useState<"3mf" | "stl" | null>(null);
  const [result, setResult] = useState<BadgeResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showLoading, setShowLoading] = useState(false);

  const fontOpt = TEXT_FONTS[cfg.fontIdx] ?? TEXT_FONTS[0];
  const fontReady = useGoogleFont(fontOpt.importUrl);
  const effFamily =
    fontOpt.family === "__custom__"
      ? cfg.customFamily
        ? `"${cfg.customFamily}", cursive`
        : "cursive"
      : fontOpt.family;

  const debCfg = useDebouncedValue(cfg, 250);

  useEffect(() => {
    if (!fontReady || fontLoading) return;
    setProcessing(true);
    const id = setTimeout(() => setShowLoading(true), 300);
    const t = setTimeout(() => {
      try {
        const r = buildBadge(
          {
            text: debCfg.text,
            fontFamily: effFamily,
            bold: debCfg.bold,
            italic: debCfg.italic,
            shape: debCfg.shape,
            widthMm: debCfg.widthMm,
            heightMm: debCfg.heightMm,
            cornerMm: debCfg.cornerMm,
            plateMm: debCfg.plateMm,
            textStyle: debCfg.textStyle,
            textMm: debCfg.textMm,
            textScale: debCfg.textScale,
            marginMm: debCfg.marginMm,
            holeEnabled: debCfg.holeEnabled,
            holeMm: debCfg.holeMm,
            holeInsetMm: debCfg.holeInsetMm,
            pixelMm: 0.12,
          },
          debCfg.plateColor,
          debCfg.textColor
        );
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
  }, [debCfg, fontReady, fontLoading, effFamily]);

  const onUploadFont = useCallback((file: File) => {
    const name = file.name.replace(/\.[^.]+$/, "") || "CustomFont";
    setFontLoading(true);
    (async () => {
      try {
        const buf = await file.arrayBuffer();
        const face = new FontFace(name, buf);
        const loaded = await face.load();
        document.fonts.add(loaded);
        setCfg((c) => ({
          ...c,
          customFamily: name,
          fontIdx: TEXT_FONTS.findIndex((f) => f.family === "__custom__"),
        }));
        setFitNonce((n) => n + 1);
      } catch (e) {
        console.error(e);
        alert("Could not load that font file.");
      } finally {
        setFontLoading(false);
      }
    })();
  }, []);

  const parts = useMemo(
    () =>
      (result?.parts ?? []).map((p) => ({
        name: p.name,
        color: p.color,
        positions: p.positions,
      })),
    [result]
  );

  const fileBase = useMemo(
    () =>
      (cfg.text.trim().split("\n")[0] || "badge")
        .toLowerCase()
        .replace(/[^a-z0-9-_()#]+/gi, "_")
        .slice(0, 40) || "badge",
    [cfg.text]
  );

  const download3MF = useCallback(async () => {
    if (parts.length === 0 || busy) return;
    setBusy("3mf");
    try {
      saveBlob(await build3MF(parts), `${fileBase}-badge.3mf`);
    } finally {
      setBusy(null);
    }
  }, [parts, busy, fileBase]);

  const downloadSTLs = useCallback(async () => {
    if (parts.length === 0 || busy) return;
    setBusy("stl");
    try {
      saveBlob(await buildSTLZip(parts), `${fileBase}-badge-stl.zip`);
    } finally {
      setBusy(null);
    }
  }, [parts, busy, fileBase]);

  const preview2d = useMemo(() => {
    if (typeof document === "undefined" || !result) return null;
    const { gw, gh, plateMask, textMask } = result;
    const scale = Math.min(1, 480 / gw);
    const w = Math.max(1, Math.round(gw * scale));
    const h = Math.max(1, Math.round(gh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    // Engraved text is recessed plate surface: shade it darker so the 2D
    // preview reads as a carving rather than a second colour.
    const shade = (c: number[]): number[] => [
      Math.round(c[0] * 0.45),
      Math.round(c[1] * 0.45),
      Math.round(c[2] * 0.45),
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(gw - 1, Math.floor(x / scale));
        const sy = Math.min(gh - 1, Math.floor(y / scale));
        const i = sy * gw + sx;
        const c =
          textMask[i] && plateMask[i]
            ? debCfg.textStyle === "raised"
              ? debCfg.textColor
              : shade(debCfg.plateColor)
            : plateMask[i]
              ? debCfg.plateColor
              : [24, 24, 27];
        const o = (y * w + x) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [result, debCfg.plateColor, debCfg.textColor, debCfg.textStyle]);


  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <ToolNav active="/badge" />
          <h1 className="text-3xl font-bold tracking-tight">
            Badge <span className="text-zinc-500">→</span> 3D Keychain
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            A shaped name badge or keychain: raised or engraved text on a
            plate, with an optional keyring hole.{" "}
            {cfg.textStyle === "raised"
              ? "Two colours, exported as one 3MF (or an STL zip)."
              : "Single colour, exported as one 3MF (or an STL)."}
            Everything runs locally in your browser.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Design
                </h2>
                {processing && <Spinner label="Updating…" />}
              </div>
              <BadgeControls
                v={cfg}
                onChange={patch}
                onUploadFont={onUploadFont}
                fontLoading={fontLoading}
              />
            </section>
          </aside>

          <section>


            {result && parts.length > 0 ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="border-b border-zinc-800 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                        Layout (2D)
                      </h3>
                    </div>
                    {preview2d && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview2d} alt="Badge preview" className="w-full" />
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
                    <span>
                      Parts: {parts.length} (
                      {cfg.textStyle === "raised" ? "plate + text" : "plate"})
                    </span>
                  </div>
                  <p className="mb-4 max-w-2xl text-xs leading-relaxed text-zinc-500">
                    {cfg.textStyle === "raised"
                      ? "Print the plate in the plate colour, swap (or use a second extruder) for the raised text. In the slicer, import the 3MF as one object with multiple parts and assign an extruder to each colour."
                      : "Single-colour print — slice with the engraved side up."}
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
                          : cfg.textStyle === "raised"
                            ? "Download 3MF (2 colour parts)"
                            : "Download 3MF"}
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
                          : cfg.textStyle === "raised"
                            ? "Download STL zip"
                            : "Download STL"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-96 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-500">
                {fontLoading || !fontReady ? "Loading font…" : "Building…"}
              </div>
            )}
          </section>
        </div>

        <footer className="mt-10 text-center text-xs text-zinc-600">
          Runs entirely in your browser — uploaded fonts never leave your device.
        </footer>
      </div>
    </main>
  );
}

