// src/services/research.service.ts
//
// Buyer-side research over the active eBay market (/api/research). One Browse
// call per uncached search, one per uncached item lookup, both cached for a few
// minutes in Redis under normalized keys and guarded by the shared daily quota.

import { createHash } from 'crypto';
import { EbayService } from './ebay.service';
import { CacheService } from './cache.service';
import { conditionIdsFor } from '../utils/conditions';
import { median, min, max, mean, quartiles } from '../utils/insights/statistics';
import { PriceStats } from '../types/ebay.types';
import {
  ResearchSearchRequest,
  ResearchSearchResult,
  ResearchListing,
  ResearchItem,
  ConditionPriceSummary,
} from '../types/research.types';

const SEARCH_TTL_SECONDS = 600;
const ITEM_TTL_SECONDS = 600;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MAX_DESCRIPTION_CHARS = 4000;

const SORTS: Record<string, string | undefined> = {
  best: undefined,
  price: 'price',
  '-price': '-price',
  newlyListed: 'newlyListed',
  endingSoonest: 'endingSoonest',
};

export class ResearchService {
  constructor(
    private ebayService: EbayService,
    private cacheService: CacheService
  ) {}

  async search(req: ResearchSearchRequest): Promise<ResearchSearchResult> {
    const cacheKey = `research:search:${hashKey(req)}`;
    const cached = await this.cacheService.getJSON<ResearchSearchResult>(cacheKey);
    if (cached) return cached;

    const filter = buildFilter(req);
    const category = req.categoryIds?.[0];
    const params: Record<string, string | number> = {
      q: req.q,
      limit: Math.min(req.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      fieldgroups: [
        'MATCHING_ITEMS',
        'CONDITION_REFINEMENTS',
        'CATEGORY_REFINEMENTS',
        ...(category ? ['ASPECT_REFINEMENTS'] : []),
      ].join(','),
    };
    if (filter) params.filter = filter;
    if (category) params.category_ids = category;
    const sort = SORTS[req.sort ?? 'best'];
    if (sort) params.sort = sort;
    const aspectFilter = buildAspectFilter(category, req.aspects);
    if (aspectFilter) params.aspect_filter = aspectFilter;

    const raw = await this.ebayService.browseGet<any>('/item_summary/search', params, {
      zip: req.zip,
    });

    const all: ResearchListing[] = (raw.itemSummaries ?? []).map(toListing);
    const excluded = exclusionPattern(req.excludedKeywords);
    const items = excluded ? all.filter((i) => !excluded.test(i.title)) : all;

    const result: ResearchSearchResult = {
      q: req.q,
      total: raw.total ?? 0,
      returned: items.length,
      excluded: all.length - items.length,
      filter,
      warnings: (raw.warnings ?? []).map(
        (w: { errorId?: number; message?: string }) => `${w.errorId}: ${w.message}`
      ),
      stats: {
        totalPrice: priceStats(items.map((i) => i.total)),
        byCondition: byCondition(items),
      },
      refinements: {
        conditions: (raw.refinement?.conditionDistributions ?? []).map((c: any) => ({
          condition: c.condition,
          conditionId: c.conditionId,
          matchCount: c.matchCount,
        })),
        categories: (raw.refinement?.categoryDistributions ?? [])
          .slice(0, 8)
          .map((c: any) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
            matchCount: c.matchCount,
          })),
        aspects: (raw.refinement?.aspectDistributions ?? []).slice(0, 12).map((a: any) => ({
          name: a.localizedAspectName,
          values: (a.aspectValueDistributions ?? [])
            .slice()
            .sort((x: any, y: any) => y.matchCount - x.matchCount)
            .slice(0, 8)
            .map((v: any) => ({ value: v.localizedAspectValue, matchCount: v.matchCount })),
        })),
      },
      items,
      fetchedAt: new Date().toISOString(),
    };

    await this.cacheService.setJSON(cacheKey, result, SEARCH_TTL_SECONDS);
    return result;
  }

  /** One listing by v1 item ID ("v1|123|0") or the legacy number in ebay.com/itm URLs. */
  async getItem(id: string, zip?: string): Promise<ResearchItem> {
    const cacheKey = `research:item:${id}:${zip ?? ''}`;
    const cached = await this.cacheService.getJSON<ResearchItem>(cacheKey);
    if (cached) return cached;

    const raw = /^\d{9,15}$/.test(id)
      ? await this.ebayService.browseGet<any>(
          '/item/get_item_by_legacy_id',
          { legacy_item_id: id },
          { zip }
        )
      : await this.ebayService.browseGet<any>(`/item/${encodeURIComponent(id)}`, {}, { zip });

    const item = toItem(raw);
    await this.cacheService.setJSON(cacheKey, item, ITEM_TTL_SECONDS);
    return item;
  }
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export function buildFilter(req: ResearchSearchRequest): string {
  const filters: string[] = ['deliveryCountry:US'];

  if (req.minPrice != null || req.maxPrice != null) {
    filters.push(`price:[${req.minPrice ?? 0}..${req.maxPrice ?? ''}]`, 'priceCurrency:USD');
  }
  const conditionIds = conditionIdsFor(req.conditions ?? []);
  if (conditionIds.length > 0) filters.push(`conditionIds:{${conditionIds.join('|')}}`);
  if (req.buyingOptions?.length) filters.push(`buyingOptions:{${req.buyingOptions.join('|')}}`);
  if (req.excludeCategoryIds?.length) {
    filters.push(`excludeCategoryIds:{${req.excludeCategoryIds.join('|')}}`);
  }
  if (req.usOnly) filters.push('itemLocationCountry:US');
  if (req.freeShipping) filters.push('maxDeliveryCost:0');
  if (req.returnsAccepted) filters.push('returnsAccepted:true');

  return filters.join(',');
}

function buildAspectFilter(
  category: string | undefined,
  aspects: Record<string, string[]> | undefined
): string | undefined {
  if (!category || !aspects || Object.keys(aspects).length === 0) return undefined;
  const parts = Object.entries(aspects)
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => `${name}:{${values.join('|')}}`);
  return parts.length ? [`categoryId:${category}`, ...parts].join(',') : undefined;
}

function exclusionPattern(words: string[] | undefined): RegExp | null {
  const cleaned = (words ?? []).map((w) => w.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const escaped = cleaned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

function hashKey(req: ResearchSearchRequest): string {
  return createHash('sha1').update(stableStringify(req)).digest('base64url');
}

/** JSON with object keys sorted at every level, so key order can't split the cache. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? 'NaN'));
  return Number.isFinite(n) ? n : null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function toListing(s: any): ResearchListing {
  const price = num(s.price?.value) ?? num(s.currentBidPrice?.value);
  const shippingOption = (s.shippingOptions ?? [])[0];
  const shipping = shippingOption ? num(shippingOption.shippingCost?.value) : null;
  return {
    itemId: s.itemId,
    legacyItemId: s.legacyItemId,
    title: s.title,
    url: s.itemWebUrl,
    image: s.thumbnailImages?.[0]?.imageUrl ?? s.image?.imageUrl,
    condition: s.condition,
    conditionId: s.conditionId,
    price,
    shipping,
    total: price == null ? null : round(price + (shipping ?? 0)),
    currency: s.price?.currency ?? s.currentBidPrice?.currency ?? 'USD',
    buyingOptions: s.buyingOptions ?? [],
    bidCount: s.bidCount,
    endsAt: s.itemEndDate,
    listedAt: s.itemOriginDate ?? s.itemCreationDate,
    isRelist: Boolean(
      s.itemCreationDate && s.itemOriginDate && s.itemCreationDate > s.itemOriginDate
    ),
    originalPrice: num(s.marketingPrice?.originalPrice?.value) ?? undefined,
    discountPercentage: num(s.marketingPrice?.discountPercentage) ?? undefined,
    seller: {
      username: s.seller?.username,
      feedbackScore: s.seller?.feedbackScore,
      feedbackPercentage: num(s.seller?.feedbackPercentage) ?? undefined,
    },
    topRated: Boolean(s.topRatedBuyingExperience),
    authenticityGuarantee: (s.qualifiedPrograms ?? []).includes('AUTHENTICITY_GUARANTEE'),
    location: s.itemLocation
      ? { country: s.itemLocation.country, postalCode: s.itemLocation.postalCode }
      : undefined,
    categoryId: s.leafCategoryIds?.[0] ?? s.categories?.[0]?.categoryId,
    epid: s.epid,
  };
}

function priceStats(values: (number | null)[]): PriceStats | null {
  const prices = values.filter((v): v is number => v != null && v > 0);
  if (prices.length === 0) return null;
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
    currency: 'USD',
  };
}

function byCondition(items: ResearchListing[]): ConditionPriceSummary[] {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    if (item.total == null) continue;
    const key = item.condition ?? 'Unspecified';
    groups.set(key, [...(groups.get(key) ?? []), item.total]);
  }
  return [...groups.entries()]
    .map(([condition, totals]) => ({
      condition,
      n: totals.length,
      median: round(median(totals)),
    }))
    .sort((a, b) => b.n - a.n);
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return text.length > MAX_DESCRIPTION_CHARS ? `${text.slice(0, MAX_DESCRIPTION_CHARS)}…` : text;
}

function toItem(r: any): ResearchItem {
  const availability = (r.estimatedAvailabilities ?? [])[0];
  return {
    itemId: r.itemId,
    legacyItemId: r.legacyItemId,
    title: r.title,
    url: r.itemWebUrl,
    condition: r.condition,
    conditionId: r.conditionId,
    conditionDescription: r.conditionDescription,
    conditionDescriptors: (r.conditionDescriptors ?? []).map((d: any) => ({
      name: d.name,
      values: (d.values ?? []).map((v: any) => v.content ?? String(v)),
    })),
    price: num(r.price?.value),
    currency: r.price?.currency ?? 'USD',
    currentBid: num(r.currentBidPrice?.value) ?? undefined,
    bidCount: r.bidCount,
    buyingOptions: r.buyingOptions ?? [],
    endsAt: r.itemEndDate,
    shipping: (r.shippingOptions ?? []).map((o: any) => ({
      service: o.shippingServiceCode,
      cost: num(o.shippingCost?.value),
      minDays: o.minEstimatedDeliveryDate,
      maxDays: o.maxEstimatedDeliveryDate,
    })),
    returns: r.returnTerms
      ? {
          accepted: Boolean(r.returnTerms.returnsAccepted),
          days: r.returnTerms.returnPeriod?.value,
          paidBy: r.returnTerms.returnShippingCostPayer,
        }
      : undefined,
    seller: {
      username: r.seller?.username,
      feedbackScore: r.seller?.feedbackScore,
      feedbackPercentage: num(r.seller?.feedbackPercentage) ?? undefined,
    },
    topRated: Boolean(r.topRatedBuyingExperience),
    available: availability
      ? {
          status: availability.estimatedAvailabilityStatus,
          quantity: availability.estimatedAvailableQuantity,
          sold: availability.estimatedSoldQuantity,
        }
      : undefined,
    aspects: (r.localizedAspects ?? []).map((a: any) => ({ name: a.name, value: a.value })),
    description: stripHtml(r.description) ?? r.shortDescription,
    categoryPath: r.categoryPath,
    location: r.itemLocation
      ? {
          city: r.itemLocation.city,
          state: r.itemLocation.stateOrProvince,
          country: r.itemLocation.country,
        }
      : undefined,
    brand: r.brand,
    mpn: r.mpn,
    gtin: r.gtin,
    epid: r.epid,
    imageCount: 1 + (r.additionalImages?.length ?? 0),
    fetchedAt: new Date().toISOString(),
  };
}
