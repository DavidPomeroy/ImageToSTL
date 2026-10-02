"use client";

import Link from "next/link";

const TABS: { href: string; label: string; experimental?: boolean }[] = [
  { href: "/", label: "Image → 3D" },
  { href: "/text", label: "Text → 3D" },
  { href: "/badge", label: "Badge → 3D" },
  { href: "/coaster", label: "Coaster → 3D" },
  { href: "/terrain", label: "Terrain → 3D", experimental: true },
];

/** Shared top navigation across the three tools. */
export default function ToolNav({ active }: { active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2 text-sm">
      {TABS.map((t) =>
        t.href === active ? (
          <span
            key={t.href}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 font-medium text-emerald-300"
          >
            {t.label}
            {t.experimental && (
              <span className="ml-1.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                Experimental
              </span>
            )}
          </span>
        ) : (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
          >
            {t.label}
            {t.experimental && (
              <span className="ml-1.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                Experimental
              </span>
            )}
          </Link>
        )
      )}
    </nav>
  );
}
