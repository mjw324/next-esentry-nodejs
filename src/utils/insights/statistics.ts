// src/utils/insights/statistics.ts
//
// Pure, deterministic statistics helpers for the Active Market Insights feature.
// No I/O — every function takes plain numbers in and returns numbers out, so the
// outlier/calibration math can be reasoned about and tested in isolation.
//
// eBay prices are heavily right-skewed, so the feature leans on robust,
// median-based measures (median, quartiles, MAD) rather than mean/stddev.

/** Arithmetic mean. Returns 0 for an empty input. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function min(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((m, v) => (v < m ? v : m), values[0]);
}

export function max(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((m, v) => (v > m ? v : m), values[0]);
}

/**
 * Linear-interpolation percentile (the "type 7" / Excel PERCENTILE.INC method).
 * `p` is a fraction in [0, 1]. `values` need NOT be pre-sorted.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, p));
  const rank = clamped * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

/** First and third quartiles plus the interquartile range. */
export function quartiles(values: number[]): { q1: number; q3: number; iqr: number } {
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  return { q1, q3, iqr: q3 - q1 };
}

/** Median absolute deviation from the median: median(|xᵢ − median(x)|). */
export function medianAbsoluteDeviation(values: number[], med?: number): number {
  if (values.length === 0) return 0;
  const center = med ?? median(values);
  const deviations = values.map((v) => Math.abs(v - center));
  return median(deviations);
}

/**
 * Modified z-scores using the MAD (Iglewicz & Hoaglin):
 *   zᵢ = 0.6745 · (xᵢ − median) / MAD
 * The 0.6745 constant scales the MAD to be consistent with the stddev of a
 * normal distribution. Items with |z| above a threshold (~3.5) are outliers.
 *
 * MAD-zero guard: when more than half the values are identical the MAD is 0 and
 * the score is undefined. We fall back to a mean-absolute-deviation scaling so
 * genuinely different values still get a non-zero score instead of Infinity.
 */
export function modifiedZScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const med = median(values);
  const mad = medianAbsoluteDeviation(values, med);

  if (mad > 0) {
    return values.map((v) => (0.6745 * (v - med)) / mad);
  }

  // Fallback: mean absolute deviation (meanAD). Constant 1.253314 ≈ sqrt(pi/2).
  const meanAd = mean(values.map((v) => Math.abs(v - med)));
  if (meanAd === 0) return values.map(() => 0);
  return values.map((v) => (v - med) / (1.253314 * meanAd));
}

/**
 * Percentile rank (0-100) of `value` within `values`: the fraction of sampled
 * values less than or equal to `value`. Used to tell the user where their
 * max-price ceiling sits among current listings.
 */
export function percentileOf(value: number, values: number[]): number {
  if (values.length === 0) return 0;
  const countAtOrBelow = values.reduce((c, v) => (v <= value ? c + 1 : c), 0);
  return (countAtOrBelow / values.length) * 100;
}
