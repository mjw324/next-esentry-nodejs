// src/utils/insights/tokens.ts
//
// Pure token analysis for the Active Market Insights feature. This is the part
// that turns "a cheap-price cluster" into the actual product signal: a cheap
// cluster in an `iPhone 17` search is usually accessories ("case", "charger",
// "cable", "screen protector"). We find tokens over-represented in a price tail
// relative to the overall result set and surface them as candidate noise terms
// to add to `excludedKeywords`.

import { NoiseTerm } from '../../types/ebay.types';

/**
 * Common English stopwords plus eBay-listing filler that should never be
 * suggested as an excluded keyword on its own.
 */
const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'without', 'of', 'to', 'in',
  'on', 'at', 'by', 'from', 'new', 'used', 'oem', 'genuine', 'original', 'lot',
  'set', 'pack', 'free', 'shipping', 'fast', 'us', 'usa', 'brand', 'item',
  'good', 'great', 'excellent', 'condition', 'fits', 'fit', 'compatible',
]);

export interface TokenizeOptions {
  /** Minimum token length to keep (default 2). */
  minLength?: number;
  /** Extra terms to drop — typically the search keywords themselves. */
  extraStopwords?: string[];
}

/**
 * Lowercase a title, split on any non-alphanumeric run, and drop stopwords,
 * pure numbers, and tokens shorter than `minLength`. Returns the DISTINCT set
 * of tokens for the title (we measure document frequency, not raw count, so a
 * word repeated in one title still counts once).
 */
export function tokenize(title: string, opts: TokenizeOptions = {}): string[] {
  const minLength = opts.minLength ?? 2;
  const extra = new Set((opts.extraStopwords ?? []).map((t) => t.toLowerCase()));

  const raw = title
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= minLength)
    .filter((t) => !/^\d+$/.test(t)) // drop pure numbers (storage sizes, years)
    .filter((t) => !STOPWORDS.has(t))
    .filter((t) => !extra.has(t));

  return [...new Set(raw)];
}

/**
 * Document frequency of each token: term → fraction of titles that contain it
 * (0-1). Also returns the raw document counts so callers can report "how many
 * listings this term would remove".
 */
export function termDocumentFrequencies(
  titles: string[],
  opts: TokenizeOptions = {}
): { fractions: Map<string, number>; counts: Map<string, number>; total: number } {
  const counts = new Map<string, number>();
  for (const title of titles) {
    for (const token of tokenize(title, opts)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const total = titles.length;
  const fractions = new Map<string, number>();
  if (total > 0) {
    for (const [term, count] of counts) {
      fractions.set(term, count / total);
    }
  }
  return { fractions, counts, total };
}

export interface OverRepresentationOptions extends TokenizeOptions {
  /** A term must appear in at least this fraction of tail titles (default 0.2). */
  minTailFraction?: number;
  /** Tail fraction must exceed overall fraction by at least this ratio (default 2). */
  minLift?: number;
  /** Cap the number of returned terms (default 10). */
  limit?: number;
}

/**
 * Find tokens over-represented in `tailTitles` (e.g. the cheap-outlier cluster)
 * relative to `overallTitles`. A term qualifies when it is common enough in the
 * tail (`minTailFraction`) and at least `minLift`× more frequent in the tail
 * than overall. Returned sorted by lift × tail-fraction (strongest signal first).
 *
 * `count` on each result is the document count in the OVERALL set — i.e. how
 * many of the sampled listings excluding that term would remove.
 */
export function overRepresentedTerms(
  tailTitles: string[],
  overallTitles: string[],
  opts: OverRepresentationOptions = {}
): NoiseTerm[] {
  const minTailFraction = opts.minTailFraction ?? 0.2;
  const minLift = opts.minLift ?? 2;
  const limit = opts.limit ?? 10;

  if (tailTitles.length === 0 || overallTitles.length === 0) return [];

  const tail = termDocumentFrequencies(tailTitles, opts);
  const overall = termDocumentFrequencies(overallTitles, opts);

  const candidates: (NoiseTerm & { score: number })[] = [];
  for (const [term, tailFraction] of tail.fractions) {
    if (tailFraction < minTailFraction) continue;
    // Smoothed overall fraction so a term absent from the overall set (e.g. it
    // only appears in tail titles already filtered out elsewhere) still ranks.
    const overallFraction = overall.fractions.get(term) ?? 1 / (overall.total + 1);
    const lift = tailFraction / overallFraction;
    if (lift < minLift) continue;

    candidates.push({
      term,
      inOutliers: round(tailFraction),
      inOverall: round(overall.fractions.get(term) ?? 0),
      count: overall.counts.get(term) ?? 0,
      score: lift * tailFraction,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...term }) => term);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
