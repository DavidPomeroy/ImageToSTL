/**
 * Slider text-entry helpers.
 *
 * Every slider in the sidebar doubles as a text field, so its value has to be
 * parsed back out of free text. These rules are kept React-free (and covered
 * by scripts/test-core.ts), so the UI only has to own the draft string.
 */

/** Decimal places implied by a slider step (0.04 -> 2, 0.25 -> 2, 5 -> 0). */
export function stepDecimals(step: number): number {
  const s = Math.abs(step).toString();
  const exp = s.indexOf("e"); // very small steps stringify as "1e-7"
  const mantissa = exp === -1 ? s : s.slice(0, exp);
  const dot = mantissa.indexOf(".");
  const frac = dot === -1 ? 0 : mantissa.length - dot - 1;
  const places = frac + (exp === -1 ? 0 : -Number(s.slice(exp + 1)));
  return Math.max(0, Math.min(6, places));
}

/**
 * Format a slider value for display. Float noise is rounded away
 * (0.30000000000000004 -> "0.3") but genuine precision the caller holds is
 * kept as-is, so the field never shows a value other than the real one
 * (e.g. 92.5 stays "92.5" even for a step of 5).
 */
export function formatSliderValue(value: number, step: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(stepDecimals(step) + 3)));
}

// First number in the text, tolerating a unit around it ("12 mm", "50%", "12mm").
const NUMBER = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/;

/**
 * Coerce typed text into a slider value, or `null` when the text holds no
 * number — the field then reverts to its current value. The result is clamped
 * to [min, max] and snapped onto the slider's own grid (min + k·step) so the
 * range input, which rounds to the nearest step itself, and the text field
 * always agree. `max` always stays reachable, even when it is not a whole
 * number of steps above `min` (e.g. thickness 0.08 → 0.3 by 0.04), because
 * dragging the handle to the end reaches it too.
 */
export function parseSliderInput(
  raw: string,
  min: number,
  max: number,
  step: number
): number | null {
  const m = raw.match(NUMBER);
  if (!m) return null;
  const typed = Number(m[0]);
  if (!Number.isFinite(typed)) return null;
  const clamped = Math.min(max, Math.max(min, typed));
  const k = step > 0 ? Math.round((clamped - min) / step) : 0;
  const onGrid = Math.min(max, Math.max(min, min + k * step));
  const snapped =
    Math.abs(clamped - max) < Math.abs(clamped - onGrid) ? max : onGrid;
  return Number(snapped.toFixed(stepDecimals(step)));
}

/**
 * Decide what a committed entry does to the slider's value: `null` means
 * "leave it alone" — the entry was cancelled (Esc), held no number, or already
 * matched the current value, so the app never sees a pointless change.
 */
export function resolveSliderCommit(
  raw: string,
  value: number,
  min: number,
  max: number,
  step: number,
  cancelled = false
): number | null {
  if (cancelled) return null;
  const next = parseSliderInput(raw, min, max, step);
  if (next === null || next === value) return null;
  return next;
}
