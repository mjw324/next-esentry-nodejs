// src/services/ebay.service.ts
import axios from 'axios';
import { Redis } from 'ioredis';
import { ebayConfig } from '../config/ebay.config';
import { EbaySearchParams, EbaySearchResults, EbayItem } from '../types/ebay.types';
import { EbayAuthService } from './ebay-auth.service';
import { RateLimitError } from '../utils/errors';

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

export class EbayService {
  // Shared application-level Browse quota counter (eBay default ~5,000/day, app
  // level — NOT per user). Soft cap leaves headroom below the real ceiling.
  private readonly QUOTA_KEY = 'ebay:api:calls:daily';
  private readonly QUOTA_SOFT_CAP = 4800;
  // Default page size for insights sampling (eBay Browse max is 200). Larger
  // than the monitoring defaultLimit (15) so price stats have a usable sample.
  private readonly INSIGHTS_DEFAULT_LIMIT = 100;

  constructor(private authService: EbayAuthService, private redis: Redis) { }

  async searchItems(params: EbaySearchParams): Promise<EbaySearchResults> {
    try {
      const accessToken = await this.authService.getAccessToken();
  
      // Build query string
      const q = params.keywords.join(' ');
  
      // Build filter string
      const filter = this.buildFilterString(params);
      console.log('Filter string: ', filter);
  
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
          }
        }
      );
  
      // Count this Browse call toward the shared app-level daily quota.
      // Non-fatal: never let quota bookkeeping break the monitoring flow.
      await this.trackBrowseCall();

      this.logApiResponseSummary(response.data, params);

      if (response.data.total === 0) {
        return response.data;
      }
  
      // Filter out items with excluded keywords
      const filteredItems = this.filterExcludedKeywords(
        response.data.itemSummaries,
        params.excludedKeywords
      );
  
      return {
        ...response.data,
        itemSummaries: filteredItems
      };
    } catch (error) {
      console.error('eBay API error:', error);
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
        }
      );

      await this.trackBrowseCall();

      return response.data;
    } catch (error) {
      // Re-throw quota errors untouched so callers can surface 429s.
      if (error instanceof RateLimitError) throw error;
      console.error('eBay market search error:', error);
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
      console.error('Error reading eBay quota counter:', error);
    }
    return { used, softCap: this.QUOTA_SOFT_CAP, remaining: Math.max(0, this.QUOTA_SOFT_CAP - used) };
  }

  /**
   * Throw a RateLimitError if issuing `neededCalls` more Browse calls would
   * exceed the soft cap. Called before insights requests so we back off near
   * the ceiling instead of burning the monitoring flow's quota.
   */
  private async assertQuota(neededCalls: number): Promise<void> {
    const { used, softCap } = await this.getQuotaUsage();
    if (used + neededCalls > softCap) {
      throw new RateLimitError(
        `eBay API daily quota nearly exhausted (${used}/${softCap}). Try again later.`
      );
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
      console.error('Error tracking eBay quota counter:', error);
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

  private logApiResponseSummary(data: EbaySearchResults, params: EbaySearchParams): void {
    // Create a condensed summary object
    const summary = {
      search: {
        keywords: params.keywords,
        excludedKeywords: params.excludedKeywords,
        priceRange: `$${params.minPrice || 'min'} - $${params.maxPrice || 'max'}`,
        conditions: params.conditions,
        sellers: params.sellers,
      },
      results: {
        total: data.total,
        count: data.itemSummaries?.length || 0,
        marketplaces: data.itemSummaries ? 
          [...new Set(data.itemSummaries.map(item => item.listingMarketplaceId))] : [],
        itemTypes: data.itemSummaries ? 
          [...new Set(data.itemSummaries.map(item => item.condition))].map(c => `${c}`).join(', ') : '',
      },
      warnings: data.warnings?.map((w: { errorId: any; message: any; }) => ({
        errorId: w.errorId,
        message: w.message
      })) || []
    };

    console.log('eBay API search summary:', JSON.stringify(summary, null, 2));

    // If there are warnings, log them more prominently
    if (data.warnings && data.warnings.length > 0) {
      console.warn('eBay API warnings:', 
        data.warnings.map((w: { message: any; }) => w.message).join('; '));
    }

    // Log a small sample of results (just titles) for verification
    if (data.itemSummaries && data.itemSummaries.length > 0) {
      console.log('Sample listings (first 3):');
      data.itemSummaries.slice(0, 3).forEach((item, i) => {
        console.log(`${i+1}. ${item.title} - $${item.price.value} (${item.condition})`);
      });
    }
  }
}
