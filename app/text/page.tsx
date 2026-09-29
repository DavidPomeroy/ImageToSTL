"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import TextControls, { TEXT_FONTS, type TextControlValues } from "@/components/TextControls";
import { LoadingOverlay, Spinner } from "@/components/Spinner";
import { build3MF, buildSTLZip } from "@/lib/exporters";
import { rgbToHex } from "@/lib/quantize";
import { buildTextSign, type TextSignResult } from "@/lib/textSign";

const PreviewGeneric = dynamic(() => import("@/components/PreviewGeneric"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">Loading 3D preview…</div>,
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
    let link = document.querySelector<HTMLLinkElement>(`link[data-tfont="${importUrl}"]`);
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
          await Promise.race([document.fonts.load(`100px "${name}"`), new Promise((r) => setTimeout(r, 3000))]);
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
export default function TextPage() {
  const [text, setText] = useState("Hello");
  const [cfg, setCfg] = useState<TextControlValues>({
    fontIdx: 4,
    customFamily: null,
    bold: false,
    italic: false,
    firstLetterScale: 1,
    lineHeight: 1.15,
    widthMm: 120,
    outlineMm: 2.5,
    insetMm: 0.9,
    baseHeightMm: 3,
    topHeightMm: 1.2,
    bg: [139, 92, 246],
    fg: [245, 245, 245],
  });
  const [fontLoading, setFontLoading] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [busy, setBusy] = useState<"3mf" | "stl" | null>(null);
  const [result, setResult] = useState<TextSignResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showLoading, setShowLoading] = useState(false);

  const patch = useCallback((p: Partial<TextControlValues>) => setCfg((c) => ({ ...c, ...p })), []);

  const fontOpt = TEXT_FONTS[cfg.fontIdx] ?? TEXT_FONTS[0];
  const fontReady = useGoogleFont(fontOpt.importUrl);
  const effFamily = fontOpt.family === "__custom__" ? (cfg.customFamily ? `"${cfg.customFamily}", cursive` : "cursive") : fontOpt.family;

  const debText = useDebouncedValue(text, 250);
  const debCfg = useDebouncedValue(cfg, 250);

  useEffect(() => {
    if (!fontReady || fontLoading) return;
    const clean = debText.trim() === "" ? " " : debText;
    setProcessing(true);
    const id = setTimeout(() => setShowLoading(true), 350);
    const t = setTimeout(() => {
      try {
        const r = buildTextSign(
          {
            text: clean,
            fontFamily: effFamily,
            bold: debCfg.bold,
            italic: debCfg.italic,
            firstLetterScale: debCfg.firstLetterScale,
            lineHeight: debCfg.lineHeight,
            widthMm: debCfg.widthMm,
            outlineMm: debCfg.outlineMm,
            insetMm: debCfg.insetMm,
            baseHeightMm: debCfg.baseHeightMm,
            topHeightMm: debCfg.topHeightMm,
            pixelMm: 0.15,
          },
          debCfg.bg,
          debCfg.fg,
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
    }, 30);
    return () => {
      clearTimeout(t);
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debText, debCfg, fontReady, fontLoading, effFamily]);

  useEffect(() => {
    if (!showLoading && processing) {
      const id = setTimeout(() => setShowLoading(true), 350);
      return () => clearTimeout(id);
    }
    if (showLoading && !processing) setShowLoading(false);
  }, [processing, showLoading]);

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
      (result?.meshes ?? []).map((m) => ({
        name: m.name,
        color: m.color,
        positions: m.positions,
      })),
    [result],
  );
  const fileBase = useMemo(
    () =>
      (text.trim().split("\n")[0] || "text-sign")
        .toLowerCase()
        .replace(/[^a-z0-9-_()#]+/gi, "_")
        .slice(0, 40) || "text-sign",
    [text],
  );

  const download3MF = useCallback(async () => {
    if (parts.length === 0 || busy) return;
    setBusy("3mf");
    try {
      const blob = await build3MF(parts);
      saveBlob(blob, `${fileBase}-text-2color.3mf`);
    } finally {
      setBusy(null);
    }
  }, [parts, busy, fileBase]);

  const downloadSTLs = useCallback(async () => {
    if (parts.length === 0 || busy) return;
    setBusy("stl");
    try {
      const blob = await buildSTLZip(parts);
      saveBlob(blob, `${fileBase}-text-2color-stl.zip`);
    } finally {
      setBusy(null);
    }
  }, [parts, busy, fileBase]);

  const preview2d = useMemo(() => {
    if (typeof document === "undefined" || !result) return null;
    const { gw, gh, outlineMask, innerMask } = result;
    const scale = Math.min(1, 480 / gw);
    const w = Math.max(1, Math.round(gw * scale));
    const h = Math.max(1, Math.round(gh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(gw - 1, Math.floor(x / scale));
        const sy = Math.min(gh - 1, Math.floor(y / scale));
        const i = sy * gw + sx;
        const c = innerMask[i] ? debCfg.fg : outlineMask[i] ? debCfg.bg : [24, 24, 27];
        const o = (y * w + x) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [result, debCfg.bg, debCfg.fg]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <nav className="mb-4 flex gap-2 text-sm">
            <Link href="/" className="rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200">
              Image → 3D
            </Link>
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 font-medium text-emerald-300">Text → 3D</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">
            Text <span className="text-zinc-500">→</span> 2-Colour 3D Sign
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">Freestanding outlined text: a background-colour rim with a raised foreground-colour inner section. Upload a script font for a decorative look.</p>
        </header>
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">1 · Your text</h2>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Hello" style={{ fontFamily: effFamily }} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-2xl text-zinc-100 focus:border-emerald-500/60 focus:outline-none" />
            </section>
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">2 · Font and colours</h2>
                {(processing || !fontReady) && <Spinner label="Updating…" />}
              </div>
              <TextControls v={cfg} onChange={patch} onUploadFont={onUploadFont} fontLoading={fontLoading} />
            </section>
          </aside>
          <section className="min-w-0">
            {result ? (
              <>
                <div className="space-y-6">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="border-b border-zinc-800 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">2D layout</h3>
                    </div>
                    <div className="flex items-center justify-center bg-zinc-950 p-4">
                      {preview2d && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview2d} alt="Text layout" className="max-h-64 rounded" />
                      )}
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">3D preview</h3>
                      <button type="button" onClick={() => setFitNonce((n) => n + 1)} className="text-xs text-zinc-500 hover:text-zinc-300">
                        Reset view
                      </button>
                    </div>
                    <div className="relative h-96 bg-zinc-950">
                      <PreviewGeneric parts={result.meshes} bboxMm={result.bboxMm} centerMm={result.centerMm} fitNonce={fitNonce} />
                      {showLoading && <LoadingOverlay title="Building…" />}
                    </div>
                  </div>
                </div>

                {result.warnings.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {result.warnings.map((w, i) => (
                      <p key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-300/90">
                        {w}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums text-zinc-400">
                    <span>
                      Size: {result.widthMm.toFixed(0)} x {result.heightMm.toFixed(0)} x {result.depthMm.toFixed(1)} mm
                    </span>
                    <span>Triangles: {Math.round(result.triangleCount).toLocaleString()}</span>
                    <span>
                      Outline {rgbToHex(cfg.bg)} · Text {rgbToHex(cfg.fg)}
                    </span>
                  </div>
                  <p className="mb-4 max-w-2xl text-xs leading-relaxed text-zinc-500">
                    The 3MF bundles outline + raised-text parts with filament colours. Print the first {cfg.baseHeightMm.toFixed(1)} mm in the outline colour, then swap to the text colour for the top {cfg.topHeightMm.toFixed(1)} mm — or print multi-material with one extruder per part.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={download3MF} disabled={busy !== null || processing} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
                      {busy === "3mf" ? "Building 3MF…" : processing ? "Updating model…" : "Download 3MF (2 colour parts)"}
                    </button>
                    <button type="button" onClick={downloadSTLs} disabled={busy !== null || processing} className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {busy === "stl" ? "Building STL…" : processing ? "Updating model…" : "Download STL zip (2 files)"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-500">{fontLoading || !fontReady ? "Loading font…" : "Building…"}</div>
            )}
          </section>
        </div>
        <footer className="mt-10 text-center text-xs text-zinc-600">Runs entirely in your browser — uploaded fonts never leave your device.</footer>
      </div>
    </main>
  );
}
