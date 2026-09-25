// Color quantization: reduce an image to N colors (median cut) and map
// every pixel to its nearest palette color.

export type RGB = [number, number, number];

/** Sentinel palette index used for transparent / empty pixels. */
export const EMPTY = 255;

export function luminance([r, g, b]: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): RGB {
  const m = hex.replace("#", "");
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

/** Collect opaque pixels (alpha >= 128) from RGBA image data. */
export function collectPixels(data: Uint8ClampedArray): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] >= 128) out.push([data[i], data[i + 1], data[i + 2]]);
  }
  return out;
}

function averageColor(pixels: RGB[]): RGB {
  let r = 0,
    g = 0,
    b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = Math.max(1, pixels.length);
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Median-cut quantization. Returns up to `count` palette colors,
 * sorted darkest -> lightest. May return fewer if the image has very
 * few distinct colors.
 */
export function medianCut(pixels: RGB[], count: number): RGB[] {
  if (pixels.length === 0 || count <= 0) return [];
  const boxes: RGB[][] = [pixels.slice()];

  while (boxes.length < count) {
    let bestIdx = -1;
    let bestRange = 0;
    let bestChan = 0;

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      const mins: RGB = [255, 255, 255];
      const maxs: RGB = [0, 0, 0];
      for (const p of box) {
        for (let c = 0; c < 3; c++) {
          if (p[c] < mins[c]) mins[c] = p[c];
          if (p[c] > maxs[c]) maxs[c] = p[c];
        }
      }
      for (let c = 0; c < 3; c++) {
        const range = maxs[c] - mins[c];
        if (range > bestRange) {
          bestRange = range;
          bestIdx = i;
          bestChan = c;
        }
      }
    }

    if (bestIdx === -1) break; // nothing splittable left

    const box = boxes.splice(bestIdx, 1)[0];
    box.sort((a, b) => a[bestChan] - b[bestChan]);
    const mid = Math.max(1, Math.floor(box.length / 2));
    boxes.push(box.slice(0, mid), box.slice(mid));
  }

  const palette = boxes.map(averageColor);
  palette.sort((a, b) => luminance(a) - luminance(b));
  return palette;
}

/** Nearest palette index using the "redmean" perceptual distance. */
export function nearestColorIndex(
  r: number,
  g: number,
  b: number,
  palette: RGB[]
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const rm = (r + p[0]) / 2;
    const d =
      (2 + rm / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Map every RGBA pixel to a palette index. Transparent pixels become EMPTY.
 * No dithering on purpose: dither dots are unprintable at mm scale.
 */
export function mapPixelsToPalette(
  data: Uint8ClampedArray,
  palette: RGB[]
): Uint8Array {
  const n = Math.floor(data.length / 4);
  const grid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 128 || palette.length === 0) {
      grid[i] = EMPTY;
      continue;
    }
    grid[i] = nearestColorIndex(data[o], data[o + 1], data[o + 2], palette);
  }
  return grid;
}

/**
 * A few Lloyd (k-means) iterations on top of a median-cut seed.
 * Median cut alone often splits one dominant cluster in two while merging
 * others; k-means refinement reliably separates the dominant colors.
 */
export function kMeansRefine(
  pixels: RGB[],
  seed: RGB[],
  iterations = 12
): RGB[] {
  if (pixels.length === 0 || seed.length === 0) return seed;
  let centers = seed.map((p) => [p[0], p[1], p[2]] as RGB);

  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      const i = nearestColorIndex(p[0], p[1], p[2], centers);
      sums[i][0] += p[0];
      sums[i][1] += p[1];
      sums[i][2] += p[2];
      sums[i][3]++;
    }
    let moved = false;
    centers = centers.map((c, i) => {
      const count = sums[i][3];
      if (count === 0) return c; // empty cluster: keep center
      const nc: RGB = [
        sums[i][0] / count,
        sums[i][1] / count,
        sums[i][2] / count,
      ];
      if (
        Math.abs(nc[0] - c[0]) + Math.abs(nc[1] - c[1]) + Math.abs(nc[2] - c[2]) >
        0.5
      )
        moved = true;
      return nc;
    });
    if (!moved) break;
  }

  return centers
    .map((c): RGB => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])])
    .sort((a, b) => luminance(a) - luminance(b));
}

/**
 * Deterministic farthest-point (k-means++ style) seeding: picks pixels that
 * are maximally spread through color space. Median cut alone tends to split
 * one dominant cluster in two while merging others; these seeds avoid that.
 */
export function farthestPointSeeds(pixels: RGB[], count: number): RGB[] {
  const n = pixels.length;
  if (n === 0) return [];
  let mr = 0,
    mg = 0,
    mb = 0;
  for (const p of pixels) {
    mr += p[0];
    mg += p[1];
    mb += p[2];
  }
  mr /= n;
  mg /= n;
  mb /= n;

  const distTo = (p: RGB, r: number, g: number, b: number) => {
    const dr = p[0] - r,
      dg = p[1] - g,
      db = p[2] - b;
    return dr * dr + dg * dg + db * db;
  };

  const seeds: RGB[] = [];
  // first seed: pixel farthest from the mean color
  let first = 0,
    bestD = -1;
  for (let i = 0; i < n; i++) {
    const d = distTo(pixels[i], mr, mg, mb);
    if (d > bestD) {
      bestD = d;
      first = i;
    }
  }
  seeds.push([pixels[first][0], pixels[first][1], pixels[first][2]]);

  // subsequent seeds: pixel farthest from its nearest existing seed
  const minDist = new Float64Array(n).fill(Infinity);
  while (seeds.length < count) {
    const s = seeds[seeds.length - 1];
    let next = 0,
      nextD = -1;
    for (let i = 0; i < n; i++) {
      const d = distTo(pixels[i], s[0], s[1], s[2]);
      if (d < minDist[i]) minDist[i] = d;
      if (minDist[i] > nextD) {
        nextD = minDist[i];
        next = i;
      }
    }
    if (nextD <= 0) break; // fewer distinct colors than requested
    seeds.push([pixels[next][0], pixels[next][1], pixels[next][2]]);
  }
  return seeds;
}

/** Sum of squared distances to each pixel's assigned center. */
function inertia(pixels: RGB[], centers: RGB[]): number {
  let sum = 0;
  for (const p of pixels) {
    const c = centers[nearestColorIndex(p[0], p[1], p[2], centers)];
    const dr = p[0] - c[0],
      dg = p[1] - c[1],
      db = p[2] - c[2];
    sum += dr * dr + dg * dg + db * db;
  }
  return sum;
}

/** Fallback palette generator when pixel input is empty or insufficient. */
function fallbackPalette(count: number): RGB[] {
  if (count <= 0) return [];
  if (count === 1) return [[128, 128, 128]];
  const out: RGB[] = [];
  for (let i = 0; i < count; i++) {
    const v = Math.round((i / (count - 1)) * 255);
    out.push([v, v, v]);
  }
  return out;
}

/**
 * Full auto-palette: run k-means from two independent seeds (median-cut and
 * farthest-point) and keep whichever clusters the image better.
 */
export function autoPalette(pixels: RGB[], count = 4): RGB[] {
  if (pixels.length === 0) return fallbackPalette(count);
  const candidates = [medianCut(pixels, count), farthestPointSeeds(pixels, count)];
  let best: RGB[] | null = null;
  let bestInertia = Infinity;
  for (const seed of candidates) {
    if (seed.length === 0) continue;
    const centers = kMeansRefine(pixels, seed);
    const score = inertia(pixels, centers);
    if (score < bestInertia) {
      bestInertia = score;
      best = centers;
    }
  }
  let result = best ?? candidates[0] ?? [];
  if (result.length < count) {
    // If fewer distinct colors than requested were found, pad with fallback colors
    const fallback = fallbackPalette(count);
    for (const fb of fallback) {
      if (result.length >= count) break;
      if (!result.some((c) => c[0] === fb[0] && c[1] === fb[1] && c[2] === fb[2])) {
        result.push(fb);
      }
    }
  }
  return result.slice().sort((a, b) => luminance(a) - luminance(b));
}

