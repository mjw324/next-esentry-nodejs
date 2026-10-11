import { EbaySearchParams } from '../types/ebay.types';

/** The monitor columns that define what it searches for. */
export interface MonitorSearchFields {
  keywords: string[];
  excludedKeywords: string[];
  minPrice: number | null;
  maxPrice: number | null;
  conditions: string[];
  sellers: string[];
}

/** The Browse search a monitor runs (a 0 or null price means no bound). */
export function monitorSearchParams(monitor: MonitorSearchFields): EbaySearchParams {
  return {
    keywords: monitor.keywords,
    excludedKeywords: monitor.excludedKeywords,
    minPrice: monitor.minPrice || undefined,
    maxPrice: monitor.maxPrice || undefined,
    conditions: monitor.conditions,
    sellers: monitor.sellers,
  };
}

/**
 * Canonical form of a search: arrays lowercased, trimmed and sorted, so
 * monitors that differ only in keyword order or case map to the same string.
 * Used for the shared search cache key and for the scheduler phase, so
 * identical searches run at the same moment and share one eBay call.
 */
export function canonicalSearch(params: EbaySearchParams): string {
  const normalize = (values: string[] | undefined) =>
    [...(values ?? [])].map((v) => v.toLowerCase().trim()).filter(Boolean).sort();

  return JSON.stringify({
    keywords: normalize(params.keywords),
    excludedKeywords: normalize(params.excludedKeywords),
    minPrice: params.minPrice ?? null,
    maxPrice: params.maxPrice ?? null,
    conditions: normalize(params.conditions),
    sellers: normalize(params.sellers),
  });
}
