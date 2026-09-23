"use client";

/** Inline spinner + label, e.g. "Updating…". Announced politely to screen readers. */
export function Spinner({ label }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-zinc-400"
      role="status"
      aria-live="polite"
    >
      <SpinnerIcon className="h-4 w-4 text-emerald-400" />
      {label}
    </span>
  );
}

export function SpinnerIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v1.5A6.5 6.5 0 0 0 5.5 12H4z"
      />
    </svg>
  );
}

/**
 * Semi-transparent overlay shown over a preview panel while the model is
 * being regenerated after a settings change.
 */
export function LoadingOverlay({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-zinc-950/70 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
    >
      <SpinnerIcon className="h-8 w-8 text-emerald-400" />
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      </div>
    </div>
  );
}

export default Spinner;
