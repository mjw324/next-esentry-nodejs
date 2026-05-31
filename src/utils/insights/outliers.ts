// src/utils/insights/outliers.ts
//
// Pure price-outlier detection for the Active Market Insights feature. Two
// robust methods are provided because eBay prices are right-skewed and a single
// method can be fooled by the skew:
//   - MAD modified z-score (primary)
//   - Tukey IQR fences (cross-check)
// Both methods and their thresholds are configurable.

import { median, quartiles, modifiedZScores } from './statistics';

export type OutlierMethod = 'mad' | 'tukey';
export type OutlierTail = 'low' | 'high';

export interface OutlierFlag {
  /** Index into the original prices array. */
  index: number;
  price: number;
  tail: OutlierTail;
  /** |modified z-score| for 'mad'; distance past the fence for 'tukey'. */
  metric: number;
  method: OutlierMethod;
}

export interface OutlierOptions {
  method?: OutlierMethod;
  /** MAD modified-z threshold; values with |z| above this are outliers. */
  madThreshold?: number;
  /** Tukey fence multiplier k: fences at Q1 − k·IQR and Q3 + k·IQR. */
  tukeyK?: number;
}

export const DEFAULT_MAD_THRESHOLD = 3.5;
export const DEFAULT_TUKEY_K = 1.5;

/** Flag prices whose MAD modified z-score exceeds `threshold`. */
export function detectByMAD(prices: number[], threshold = DEFAULT_MAD_THRESHOLD): OutlierFlag[] {
  if (prices.length < 3) return [];
  const scores = modifiedZScores(prices);
  const flags: OutlierFlag[] = [];
  scores.forEach((z, index) => {
    if (Math.abs(z) > threshold) {
      flags.push({
        index,
        price: prices[index],
        tail: z < 0 ? 'low' : 'high',
        metric: Math.abs(z),
        method: 'mad',
      });
    }
  });
  return flags;
}

/** Flag prices outside the Tukey fences: < Q1 − k·IQR (low) or > Q3 + k·IQR (high). */
export function detectByTukey(prices: number[], k = DEFAULT_TUKEY_K): OutlierFlag[] {
  if (prices.length < 4) return [];
  const { q1, q3, iqr } = quartiles(prices);
  if (iqr === 0) return [];
  const lowFence = q1 - k * iqr;
  const highFence = q3 + k * iqr;
  const flags: OutlierFlag[] = [];
  prices.forEach((price, index) => {
    if (price < lowFence) {
      flags.push({ index, price, tail: 'low', metric: lowFence - price, method: 'tukey' });
    } else if (price > highFence) {
      flags.push({ index, price, tail: 'high', metric: price - highFence, method: 'tukey' });
    }
  });
  return flags;
}

/** Dispatch to the configured method (defaults to MAD). */
export function detectOutliers(prices: number[], opts: OutlierOptions = {}): OutlierFlag[] {
  const method = opts.method ?? 'mad';
  return method === 'tukey'
    ? detectByTukey(prices, opts.tukeyK)
    : detectByMAD(prices, opts.madThreshold);
}

/**
 * Suggest a tightened {minPrice, maxPrice} that clamps off the outlier tails.
 * Uses the Tukey fences (the more interpretable of the two) intersected with
 * the observed price range, and floored at 0. Returns undefined when there is
 * nothing meaningful to tighten.
 */
export function suggestedPriceRangeFromFences(
  prices: number[],
  k = DEFAULT_TUKEY_K
): { minPrice: number; maxPrice: number } | undefined {
  if (prices.length < 4) return undefined;
  const { q1, q3, iqr } = quartiles(prices);
  if (iqr === 0) return undefined;

  const observedMin = Math.min(...prices);
  const observedMax = Math.max(...prices);
  const lowFence = q1 - k * iqr;
  const highFence = q3 + k * iqr;

  const minPrice = Math.max(0, Math.max(observedMin, Math.floor(lowFence)));
  const maxPrice = Math.min(observedMax, Math.ceil(highFence));

  // Only suggest if the band actually narrows the observed range.
  if (minPrice <= observedMin && maxPrice >= observedMax) return undefined;
  if (minPrice >= maxPrice) return undefined;

  return { minPrice, maxPrice };
}

/** Convenience: the median price of a sample (re-exported for orchestration). */
export function samplePriceMedian(prices: number[]): number {
  return median(prices);
}
