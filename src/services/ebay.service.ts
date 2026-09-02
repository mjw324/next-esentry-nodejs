// src/services/ebay.service.ts
import axios from 'axios';
import { createHash } from 'crypto';
import { Redis } from 'ioredis';
import { ebayConfig } from '../config/ebay.config';
import { EbaySearchParams, EbaySearchResults, EbayItem } from '../types/ebay.types';
import { EbayAuthService } from './ebay-auth.service';
import { RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';

// Default fieldgroups for an insights snapshot call. MATCHING_ITEMS keeps the
// itemSummaries in the response while the *_REFINEMENTS groups add the
// aggregate distributions. Tokens current as of the eBay Browse API in early
// 2026 — re-verify against the docs if eBay changes them.
export const INSIGHTS_FIELDGROUPS = [
  'MATCHING_ITEMS',
  'ASPECT_REFINEMENTS',
  'CONDITION_REFINEMENTS',
  'CATEGORY_REFINEMENTS',
  'BUYING_OPTION_REFINEMENTS',
];

// eBay Browse price sort tokens: ascending = 'price', descending = '-price'.
export const SORT_PRICE_ASC = 'price';
export const SORT_PRICE_DESC = '-price';

export interface SearchMarketOptions {
  fieldgroups?: string[];
  sort?: string;
  limit?: number;
  offset?: number;
}

/**
 * Outbound timeout for Browse calls. axios defaults to none, so a hung
 * connection to eBay held a worker slot forever; with concurrency 5, five
 * stuck calls stopped all monitoring silently while BullMQ's stalled-check
 * kept re-queueing the jobs.
 */
const EBAY_REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long an identical monitoring search is reused.
 *
 * Two monitors with the same keywords and filters issue two identical Browse
 * calls. BullMQ aligns `every: N` schedules to epoch multiples, so monitors
 * sharing an interval fire in the same instant -- which makes the collision
 * likely rather than incidental. Each monitor still diffs against its own
 * snapshot; only the upstream call is shared, so behaviour is unchanged.
 *
 * Kept well below the 5-minute minimum interval so a monitor never sees the
 * same response twice in consecutive runs.
 */
const SEARCH_CACHE_TTL_SECONDS = 60;

export class EbayService {
  // Shared application-level Browse quota counter (eBay default ~5,000/day, app
  // level — NOT per user). Soft cap leaves headroom below the real ceiling.
  private readonly QUOTA_KEY = 'ebay:api:calls:daily';
  private readonly QUOTA_SOFT_CAP = 4800;
  // Default page size for insights sampling (eBay Browse max is 200). Larger
  // than the monitoring defaultLimit (15) so price stats have a usable sample.
  private readonly INSIGHTS_DEFAULT_LIMIT = 100;

  constructor(private authService: EbayAuthService, private redis: Redis) { }

  /**
   * Stable cache key for a monitoring search. Arrays are lowercased, trimmed
   * and sorted so semantically identical parameter sets collapse together, then
   * hashed to keep the key short regardless of how many keywords there are.
   */
  private searchCacheKey(params: EbaySearchParams): string {
    const normalize = (values: string[] | undefined) =>
      [...(values ?? [])].map((v) => v.toLowerCase().trim()).filter(Boolean).sort();

    const canonical = JSON.stringify({
      keywords: normalize(params.keywords),
      excludedKeywords: normalize(params.excludedKeywords),
      minPrice: params.minPrice ?? null,
      maxPrice: params.maxPrice ?? null,
      conditions: normalize(params.conditions),
      sellers: normalize(params.sellers),
    });

    return `ebay:search:${createHash('sha1').update(canonical).digest('base64url')}`;
  }

  async searchItems(params: EbaySearchParams): Promise<EbaySearchResults> {
    const cacheKey = this.searchCacheKey(params);

    // Reuse an identical search issued moments ago by another monitor.
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.debug('ebay.search.cache_hit', { keywords: params.keywords.length });
        return JSON.parse(cached) as EbaySearchResults;
      }
    } catch (error) {
      // A cache miss and a broken cache are the same thing here: call eBay.
      logger.error('ebay.search.cache_read_failed', { error });
    }

    try {
      const accessToken = await this.authService.getAccessToken();

      // Build query string
      const q = params.keywords.join(' ');

      // Build filter string
      const filter = this.buildFilterString(params);

      const response = await axios.get<EbaySearchResults>(
        `${ebayConfig.apiUrl}/item_summary/search`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US',
          },
          params: {
            q,
            filter,
            sort: 'newlyListed',
            limit: ebayConfig.defaultLimit
          },
          timeout: EBAY_REQUEST_TIMEOUT_MS,
        }
      );
  
      // Count this Browse call toward the shared app-level daily quota.
      // Non-fatal: never let quota bookkeeping break the monitoring flow.
      await this.trackBrowseCall();

      this.logApiResponseSummary(response.data, params);

      // Excluded keywords are part of the cache key, so the post-filter result
      // is what gets shared.
      const result: EbaySearchResults =
        response.data.total === 0
          ? response.data
          : {
              ...response.data,
              itemSummaries: this.filterExcludedKeywords(
                response.data.itemSummaries,
                params.excludedKeywords
              ),
            };

      await this.cacheSearchResult(cacheKey, result);

      return result;
    } catch (error) {
      // Log only status + body. The raw axios error carries config.headers,
      // which includes the bearer token.
      logger.error('ebay.search.failed', {
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
        body: axios.isAxiosError(error) ? error.response?.data : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to fetch items from eBay');
    }
  }
  

  /**
   * Issue a Browse search and return the RAW response, including the
   * `refinement` distributions when `fieldgroups` requests them. Unlike
   * `searchItems`, this does NOT strip excluded keywords — the insights feature
   * needs the unfiltered market view (it's what produces exclusion suggestions).
   *
   * Reuses the existing `buildFilterString` so filter semantics stay identical
   * to the monitoring path. Guards and counts the call against the app-level
   * daily quota.
   */
  async searchMarketRaw(params: EbaySearchParams, opts: SearchMarketOptions = {}): Promise<EbaySearchResults> {
    await this.assertQuota(1);

    try {
      const accessToken = await this.authService.getAccessToken();

      const q = params.keywords.join(' ');
      const filter = this.buildFilterString(params);

      const queryParams: Record<string, string | number> = {
        q,
        filter,
        limit: opts.limit ?? this.INSIGHTS_DEFAULT_LIMIT,
        offset: opts.offset ?? 0,
        fieldgroups: (opts.fieldgroups ?? INSIGHTS_FIELDGROUPS).join(','),
      };
      if (opts.sort) {
        queryParams.sort = opts.sort;
      }

      const response = await axios.get<EbaySearchResults>(
        `${ebayConfig.apiUrl}/item_summary/search`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US',
          },
          params: queryParams,
          timeout: EBAY_REQUEST_TIMEOUT_MS,
        }
      );

      await this.trackBrowseCall();

      return response.data;
    } catch (error) {
      // Re-throw quota errors untouched so callers can surface 429s.
      if (error instanceof RateLimitError) throw error;
      logger.error('ebay.market.failed', {
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
        body: axios.isAxiosError(error) ? error.response?.data : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to fetch market data from eBay');
    }
  }

  /**
   * Current app-level Browse quota usage for the day. Backed by a Redis counter
   * incremented on every Browse call (monitoring + insights share it, since the
   * eBay limit is per application, not per user).
   */
  async getQuotaUsage(): Promise<{ used: number; softCap: number; remaining: number }> {
    let used = 0;
    try {
      const raw = await this.redis.get(this.QUOTA_KEY);
      used = raw ? parseInt(raw, 10) : 0;
    } catch (error) {
      logger.error('ebay.quota.read_failed', { error });
    }
    return { used, softCap: this.QUOTA_SOFT_CAP, remaining: Math.max(0, this.QUOTA_SOFT_CAP - used) };
  }

  /**
   * Throw a RateLimitError if issuing `neededCalls` more Browse calls would
   * exceed the soft cap. Called before insights requests so we back off near
   * the ceiling instead of burning the monitoring flow's quota.
   */
  async assertQuota(neededCalls: number): Promise<void> {
    const { used, softCap } = await this.getQuotaUsage();
    if (used + neededCalls > softCap) {
      throw new RateLimitError(
        `eBay API daily quota nearly exhausted (${used}/${softCap}). Try again later.`
      );
    }
  }

  /** Store a search result for reuse. Non-throwing -- caching is best effort. */
  private async cacheSearchResult(key: string, result: EbaySearchResults): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify(result),
        'EX',
        SEARCH_CACHE_TTL_SECONDS
      );
    } catch (error) {
      logger.error('ebay.search.cache_write_failed', { error });
    }
  }

  /** Increment the daily Browse counter. Non-throwing — bookkeeping only. */
  private async trackBrowseCall(): Promise<void> {
    try {
      const count = await this.redis.incr(this.QUOTA_KEY);
      // First increment of the day: expire the counter at the next midnight.
      if (count === 1) {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000);
        await this.redis.expire(this.QUOTA_KEY, secondsUntilMidnight);
      }
    } catch (error) {
      logger.error('ebay.quota.track_failed', { error });
    }
  }

  private buildFilterString(params: EbaySearchParams): string {
    const filters: string[] = [];
  
    // Add price filter with currency only when price is specified
    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      // Format price filter correctly
      const priceFilter = `price:[${params.minPrice || '0'}..${params.maxPrice || ''}]`;
      filters.push(priceFilter);
  
      // Add currency filter only when using price
      filters.push('priceCurrency:USD');
    }
  
    // Add condition filter
    if (params.conditions.length > 0) {
      filters.push(`conditionIds:{${params.conditions.join('|')}}`);
    }
  
    // Add sellers filter
    if (params.sellers.length > 0) {
      filters.push(`sellers:{${params.sellers.join('|')}}`);
    }
  
    return filters.join(',');
  }

  private filterExcludedKeywords(items: EbayItem[], excludedKeywords: string[]): EbayItem[] {
    if (!excludedKeywords.length) return items;

    const excludedPattern = new RegExp(excludedKeywords.join('|'), 'i');
    return items.filter(item => !excludedPattern.test(item.title));
  }

  /**
   * One structured line per search. Previously this emitted ~25 lines of
   * indented JSON per call plus up to three sample titles, which at 293
   * calls/day was ~7,300 log lines for two monitors.
   */
  private logApiResponseSummary(data: EbaySearchResults, params: EbaySearchParams): void {
    logger.info('ebay.search', {
      keywords: params.keywords.length,
      total: data.total,
      returned: data.itemSummaries?.length ?? 0,
    });

    // Warnings are rare and actionable, so they get their own line -- but only
    // when present, rather than logging an empty array every time.
    if (data.warnings?.length) {
      logger.warn('ebay.search.warnings', {
        warnings: data.warnings.map((w: { errorId: unknown; message: unknown }) => ({
          errorId: w.errorId,
          message: w.message,
        })),
      });
    }

    // Full detail stays available at debug level, built only when emitted.
    if (logger.isDebug()) {
      logger.debug('ebay.search.detail', {
        keywords: params.keywords,
        excludedKeywords: params.excludedKeywords,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        conditions: params.conditions,
        sellers: params.sellers,
        sample: (data.itemSummaries ?? []).slice(0, 3).map((item) => ({
          title: item.title,
          price: item.price?.value,
          condition: item.condition,
        })),
      });
    }
  }
}
