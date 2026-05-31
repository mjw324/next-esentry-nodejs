// src/services/insights.service.ts
//
// Orchestrates the Active Market Insights feature: it issues a bounded number
// of eBay Browse calls, then derives the market snapshot, outliers, and
// calibration summary using the pure functions in src/utils/insights.
//
// Quota discipline (≤3 Browse calls per request): the three endpoints share a
// cached raw sample. The snapshot call (with refinement fieldgroups) and the
// price-ascending / price-descending tail calls are each cached by normalized
// params, so a cold `calibrate` costs at most 3 calls and a warm one costs 0.

import {
  EbaySearchParams,
  EbaySearchResults,
  EbayItem,
  MarketSnapshot,
  OutlierResult,
  OutlierListing,
  CalibrationSummary,
  PriceStats,
  ConditionBreakdown,
  BuyingOptionSplit,
  AspectSummary,
  NoiseTerm,
} from '../types/ebay.types';
import {
  EbayService,
  INSIGHTS_FIELDGROUPS,
  SORT_PRICE_ASC,
  SORT_PRICE_DESC,
} from './ebay.service';
import { CacheService } from './cache.service';
import { mean, min, max, median, quartiles, percentileOf } from '../utils/insights/statistics';
import { detectOutliers, suggestedPriceRangeFromFences, OutlierFlag } from '../utils/insights/outliers';
import { tokenize, overRepresentedTerms } from '../utils/insights/tokens';

// How many flagged listings to return at most.
const MAX_OUTLIER_LISTINGS = 20;
// Page size per Browse call (eBay Browse max is 200).
const SAMPLE_LIMIT = 100;
// Tails for token analysis are defined RELATIVE TO THE MEDIAN: a listing
// priced below half the median is "suspiciously cheap" (likely an accessory),
// one above 2.5× the median is "suspiciously expensive" (likely a bundle/lot).
// Median-relative (rather than a fixed quantile or MAD) captures the whole
// gap-separated cheap cluster and stays robust while noise is a minority of
// results. NOTE: if noise listings exceed ~half the results the median itself
// lands in the noise cluster and this signal degrades (documented limitation).
const LOW_TAIL_RATIO = 0.5;
const HIGH_TAIL_RATIO = 2.5;

// Cache TTLs (seconds). Raw eBay responses live a bit longer than derived
// results so derived recomputation stays cheap during form editing.
const RAW_TTL = 300; // 5 min
const DERIVED_TTL = 180; // 3 min

export class InsightsService {
  constructor(
    private ebayService: EbayService,
    private cacheService: CacheService
  ) {}

  // -------------------------------------------------------------------------
  // Phase 1 — current-market snapshot (1 Browse call: the fieldgroups call)
  // -------------------------------------------------------------------------
  async getMarketSnapshot(params: EbaySearchParams): Promise<MarketSnapshot> {
    const cacheKey = this.cacheService.buildInsightsKey('market', params);
    const cached = await this.cacheService.getJSON<MarketSnapshot>(cacheKey);
    if (cached) return cached;

    const raw = await this.getSnapshotRaw(params);
    const snapshot = this.buildSnapshot(raw);

    await this.cacheService.setJSON(cacheKey, snapshot, DERIVED_TTL);
    return snapshot;
  }

  // -------------------------------------------------------------------------
  // Phase 2 — outlier detection + refinement suggestions (≤3 Browse calls)
  // -------------------------------------------------------------------------
  async getOutliers(params: EbaySearchParams): Promise<OutlierResult> {
    const cacheKey = this.cacheService.buildInsightsKey('outliers', params);
    const cached = await this.cacheService.getJSON<OutlierResult>(cacheKey);
    if (cached) return cached;

    const { items } = await this.gatherSample(params);
    const result = this.buildOutlierResult(params, items);

    await this.cacheService.setJSON(cacheKey, result, DERIVED_TTL);
    return result;
  }

  // -------------------------------------------------------------------------
  // Phase 3 — calibration summary for the create-monitor form (≤3 calls,
  // reuses the Phase 1/2 caches)
  // -------------------------------------------------------------------------
  async getCalibration(params: EbaySearchParams): Promise<CalibrationSummary> {
    const cacheKey = this.cacheService.buildInsightsKey('calibrate', params);
    const cached = await this.cacheService.getJSON<CalibrationSummary>(cacheKey);
    if (cached) return cached;

    // Both reuse the shared raw-sample caches, so this stays within 3 calls.
    const { items, total } = await this.gatherSample(params);
    const outlier = this.buildOutlierResult(params, items);

    const prices = this.pricesOf(items);
    const noiseTerms = outlier.suggestedRefinements.suggestedExcludedKeywords;
    const noiseFraction = this.computeNoiseFraction(items, noiseTerms);

    const summary: CalibrationSummary = {
      totalActive: total,
      sampleSize: items.length,
      maxPricePercentile:
        params.maxPrice !== undefined && prices.length > 0
          ? round(percentileOf(params.maxPrice, prices))
          : undefined,
      noiseFraction: round(noiseFraction),
      topSuggestedExcludedKeywords: noiseTerms.slice(0, 5),
      suggestedPriceRange: outlier.suggestedRefinements.suggestedPriceRange,
    };

    await this.cacheService.setJSON(cacheKey, summary, DERIVED_TTL);
    return summary;
  }

  // -------------------------------------------------------------------------
  // Internal: bounded, cached eBay sampling
  // -------------------------------------------------------------------------

  /** Call 1: the snapshot call with refinement fieldgroups. Cached raw. */
  private async getSnapshotRaw(params: EbaySearchParams): Promise<EbaySearchResults> {
    const key = this.cacheService.buildInsightsKey('snapshot-raw', params);
    const cached = await this.cacheService.getJSON<EbaySearchResults>(key);
    if (cached) return cached;

    const raw = await this.ebayService.searchMarketRaw(params, {
      fieldgroups: INSIGHTS_FIELDGROUPS,
      limit: SAMPLE_LIMIT,
    });
    await this.cacheService.setJSON(key, raw, RAW_TTL);
    return raw;
  }

  /** A price-sorted tail call (asc or desc). Cached raw under its own key. */
  private async getTailRaw(params: EbaySearchParams, sort: string, namespace: string): Promise<EbaySearchResults> {
    const key = this.cacheService.buildInsightsKey(namespace, params);
    const cached = await this.cacheService.getJSON<EbaySearchResults>(key);
    if (cached) return cached;

    const raw = await this.ebayService.searchMarketRaw(params, {
      sort,
      fieldgroups: ['MATCHING_ITEMS'], // tails don't need distributions
      limit: SAMPLE_LIMIT,
    });
    await this.cacheService.setJSON(key, raw, RAW_TTL);
    return raw;
  }

  /**
   * Gather the deduped item sample used for outlier/token analysis: the
   * representative snapshot page plus both price tails. Reuses the snapshot
   * cache from Phase 1, so this is at most 3 calls (often fewer when warm).
   */
  private async gatherSample(params: EbaySearchParams): Promise<{ items: EbayItem[]; total: number }> {
    const [snapshot, asc, desc] = await Promise.all([
      this.getSnapshotRaw(params),
      this.getTailRaw(params, SORT_PRICE_ASC, 'asc-raw'),
      this.getTailRaw(params, SORT_PRICE_DESC, 'desc-raw'),
    ]);

    const byId = new Map<string, EbayItem>();
    for (const response of [snapshot, asc, desc]) {
      for (const item of response.itemSummaries ?? []) {
        if (item.itemId && !byId.has(item.itemId)) byId.set(item.itemId, item);
      }
    }

    return { items: [...byId.values()], total: snapshot.total ?? 0 };
  }

  // -------------------------------------------------------------------------
  // Internal: pure-function assembly
  // -------------------------------------------------------------------------

  private buildSnapshot(raw: EbaySearchResults): MarketSnapshot {
    const items = raw.itemSummaries ?? [];
    const prices = this.pricesOf(items);
    const currency = items[0]?.price?.currency ?? 'USD';

    return {
      totalActive: raw.total ?? 0,
      priceStats: prices.length > 0 ? this.computePriceStats(prices, currency) : null,
      conditionDistribution: this.mapConditions(raw),
      buyingOptions: this.mapBuyingOptions(raw),
      topAspects: this.mapTopAspects(raw),
      sampleBased: true,
      sampleSize: prices.length,
    };
  }

  private buildOutlierResult(params: EbaySearchParams, items: EbayItem[]): OutlierResult {
    // Restrict to items with a usable price so detection indices stay aligned
    // 1:1 with the price array.
    const pricedItems = items.filter((i) => Number.isFinite(this.priceOf(i)) && this.priceOf(i) > 0);
    const prices = pricedItems.map((i) => this.priceOf(i));
    const overallTitles = pricedItems.map((i) => i.title);
    const med = median(prices);

    // Query keywords themselves must never be suggested as noise.
    const extraStopwords = params.keywords.flatMap((k) => k.toLowerCase().split(/[^a-z0-9]+/i));

    // --- Noise terms via median-relative tails (robust while noise is a minority) ---
    // Compare the suspiciously-cheap and suspiciously-expensive slices against
    // the whole set. The low tail is the primary signal (accessories); the high
    // tail catches bundles/lots. Merge, low-tail-first, deduped by term.
    const lowCut = med * LOW_TAIL_RATIO;
    const highCut = med * HIGH_TAIL_RATIO;
    const lowTailTitles = pricedItems.filter((i) => this.priceOf(i) <= lowCut).map((i) => i.title);
    const highTailTitles = pricedItems.filter((i) => this.priceOf(i) >= highCut).map((i) => i.title);

    const noiseTerms = this.mergeNoiseTerms(
      overRepresentedTerms(lowTailTitles, overallTitles, { extraStopwords }),
      overRepresentedTerms(highTailTitles, overallTitles, { extraStopwords })
    );
    const noiseTermSet = new Set(noiseTerms.map((t) => t.term));

    // --- Displayed outliers: union of robust price-outliers and token matches ---
    const priceFlags = new Map<number, OutlierFlag>();
    for (const flag of detectOutliers(prices, { method: 'mad' })) {
      priceFlags.set(flag.index, flag);
    }

    const outlierListings: OutlierListing[] = pricedItems
      .map((item, idx) => this.toOutlierListing(item, idx, priceFlags.get(idx), noiseTermSet, extraStopwords, med))
      .filter((o): o is OutlierListing => o !== null)
      .sort((a, b) => b.metric - a.metric)
      .slice(0, MAX_OUTLIER_LISTINGS);

    // --- Suggested price range: clamp off the noise listings if we found any,
    // otherwise fall back to robust Tukey fences on the whole sample. ---
    const cleanPrices = pricedItems
      .filter((i) => !tokenize(i.title, { extraStopwords }).some((t) => noiseTermSet.has(t)))
      .map((i) => this.priceOf(i));
    const suggestedPriceRange = this.suggestPriceRange(prices, cleanPrices, noiseTerms.length > 0);

    return {
      outlierListings,
      suggestedRefinements: {
        suggestedExcludedKeywords: noiseTerms,
        suggestedPriceRange,
      },
      sampleSize: items.length,
    };
  }

  /**
   * Build a displayed outlier entry, or null if the item is neither a robust
   * price outlier nor a token-noise match.
   */
  private toOutlierListing(
    item: EbayItem,
    idx: number,
    priceFlag: OutlierFlag | undefined,
    noiseTermSet: Set<string>,
    extraStopwords: string[],
    med: number
  ): OutlierListing | null {
    const matchedTokens = tokenize(item.title, { extraStopwords }).filter((t) => noiseTermSet.has(t));
    if (!priceFlag && matchedTokens.length === 0) return null;

    const price = this.priceOf(item);
    return {
      itemId: item.itemId,
      title: item.title,
      price,
      metric: round(Math.abs(price - med)),
      method: priceFlag ? priceFlag.method : 'token',
      tail: priceFlag ? priceFlag.tail : price < med ? 'low' : 'high',
      matchedTokens,
    };
  }

  /** Merge two NoiseTerm lists, low-tail first, deduped by term, capped. */
  private mergeNoiseTerms(primary: NoiseTerm[], secondary: NoiseTerm[], limit = 10): NoiseTerm[] {
    const seen = new Set(primary.map((t) => t.term));
    const merged = [...primary];
    for (const term of secondary) {
      if (!seen.has(term.term)) {
        seen.add(term.term);
        merged.push(term);
      }
    }
    return merged.slice(0, limit);
  }

  /**
   * Suggest a tightened {minPrice, maxPrice}. When token analysis found noise,
   * clamp to the observed range of the non-noise listings (this handles the
   * bimodal accessories case the Tukey fences miss). Otherwise fall back to
   * robust Tukey fences on the full sample (the unimodal right-skew case).
   */
  private suggestPriceRange(
    allPrices: number[],
    cleanPrices: number[],
    hasNoise: boolean
  ): { minPrice: number; maxPrice: number } | undefined {
    if (hasNoise && cleanPrices.length > 0 && cleanPrices.length < allPrices.length) {
      const minPrice = Math.max(0, Math.floor(min(cleanPrices)));
      const maxPrice = Math.ceil(max(cleanPrices));
      const observedMin = min(allPrices);
      const observedMax = max(allPrices);
      // Only suggest if it actually narrows the observed range.
      if ((minPrice > observedMin || maxPrice < observedMax) && minPrice < maxPrice) {
        return { minPrice, maxPrice };
      }
    }
    return suggestedPriceRangeFromFences(allPrices);
  }

  private computePriceStats(prices: number[], currency: string): PriceStats {
    const { q1, q3, iqr } = quartiles(prices);
    return {
      min: round(min(prices)),
      max: round(max(prices)),
      mean: round(mean(prices)),
      median: round(median(prices)),
      q1: round(q1),
      q3: round(q3),
      iqr: round(iqr),
      sampleSize: prices.length,
      currency,
    };
  }

  private mapConditions(raw: EbaySearchResults): ConditionBreakdown[] {
    return (raw.refinement?.conditionDistributions ?? []).map((c) => ({
      condition: c.condition,
      conditionId: c.conditionId,
      matchCount: c.matchCount,
    }));
  }

  private mapBuyingOptions(raw: EbaySearchResults): BuyingOptionSplit[] {
    return (raw.refinement?.buyingOptionDistributions ?? []).map((b) => ({
      buyingOption: b.buyingOption,
      matchCount: b.matchCount,
    }));
  }

  private mapTopAspects(raw: EbaySearchResults, maxAspects = 5, maxValues = 5): AspectSummary[] {
    return (raw.refinement?.aspectDistributions ?? []).slice(0, maxAspects).map((a) => ({
      name: a.localizedAspectName,
      values: (a.aspectValueDistributions ?? [])
        .slice()
        .sort((x, y) => y.matchCount - x.matchCount)
        .slice(0, maxValues)
        .map((v) => ({ value: v.localizedAspectValue, matchCount: v.matchCount })),
    }));
  }

  /** Fraction of sampled items whose title contains any suggested noise term. */
  private computeNoiseFraction(items: EbayItem[], noiseTerms: NoiseTerm[]): number {
    if (items.length === 0 || noiseTerms.length === 0) return 0;
    const terms = new Set(noiseTerms.map((t) => t.term));
    const matching = items.filter((i) => tokenize(i.title).some((tok) => terms.has(tok)));
    return matching.length / items.length;
  }

  private pricesOf(items: EbayItem[]): number[] {
    return items.map((i) => this.priceOf(i)).filter((p) => Number.isFinite(p) && p > 0);
  }

  private priceOf(item: EbayItem): number {
    return parseFloat(item.price?.value ?? 'NaN');
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
