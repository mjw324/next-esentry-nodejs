// ===========================================================================
// Research API contracts (/api/research). A buyer-side view of the active eBay
// market for one-off product research, rather than a monitor's newest-15 diff:
// shipping-inclusive totals, real condition filters, auctions, seller quality.
// See docs/RESEARCH.md.
// ===========================================================================

import { PriceStats } from './ebay.types';

export type ResearchSort = 'best' | 'price' | '-price' | 'newlyListed' | 'endingSoonest';

export interface ResearchSearchRequest {
  q: string;
  /** Condition names (NEW, OPEN_BOX, REFURBISHED, USED, FOR_PARTS, ...) or eBay IDs. */
  conditions?: string[];
  /** eBay allows one category per search; extra IDs are ignored. */
  categoryIds?: string[];
  excludeCategoryIds?: string[];
  buyingOptions?: ('FIXED_PRICE' | 'AUCTION' | 'BEST_OFFER')[];
  minPrice?: number | null;
  maxPrice?: number | null;
  /** Dropped client-side by whole-word, case-insensitive title match. */
  excludedKeywords?: string[];
  /** Aspect filters, e.g. { "RAM Size": ["16 GB"] }. Need a category. */
  aspects?: Record<string, string[]>;
  sort?: ResearchSort;
  limit?: number;
  usOnly?: boolean;
  freeShipping?: boolean;
  returnsAccepted?: boolean;
  /** Buyer ZIP for calculated shipping. */
  zip?: string;
}

export interface ResearchListing {
  itemId: string;
  legacyItemId?: string;
  title: string;
  url: string;
  image?: string;
  condition?: string;
  conditionId?: string;
  /** Fixed price, or the current bid for an auction-only listing. */
  price: number | null;
  /** null when eBay could not calculate it for this buyer. */
  shipping: number | null;
  /** price + shipping (shipping counted as 0 when unknown). */
  total: number | null;
  currency: string;
  buyingOptions: string[];
  bidCount?: number;
  endsAt?: string;
  listedAt?: string;
  isRelist: boolean;
  originalPrice?: number;
  discountPercentage?: number;
  seller: {
    username?: string;
    feedbackScore?: number;
    feedbackPercentage?: number;
  };
  topRated: boolean;
  authenticityGuarantee: boolean;
  location?: { country?: string; postalCode?: string };
  categoryId?: string;
  epid?: string;
}

export interface ConditionPriceSummary {
  condition: string;
  n: number;
  median: number;
}

export interface ResearchSearchResult {
  q: string;
  /** eBay's reported total for the query (approximate, full population). */
  total: number;
  /** Listings returned after keyword exclusion. */
  returned: number;
  excluded: number;
  filter: string;
  warnings: string[];
  stats: {
    /** Sample-based, over shipping-inclusive totals. */
    totalPrice: PriceStats | null;
    byCondition: ConditionPriceSummary[];
  };
  refinements: {
    conditions: { condition: string; conditionId: string; matchCount: number }[];
    categories: { categoryId: string; categoryName: string; matchCount: number }[];
    aspects: { name: string; values: { value: string; matchCount: number }[] }[];
  };
  items: ResearchListing[];
  fetchedAt: string;
}

export interface ResearchItem {
  itemId: string;
  legacyItemId?: string;
  title: string;
  url: string;
  condition?: string;
  conditionId?: string;
  conditionDescription?: string;
  conditionDescriptors?: { name: string; values: string[] }[];
  price: number | null;
  currency: string;
  currentBid?: number;
  bidCount?: number;
  buyingOptions: string[];
  endsAt?: string;
  shipping: { service?: string; cost: number | null; minDays?: string; maxDays?: string }[];
  returns?: { accepted: boolean; days?: number; paidBy?: string };
  seller: { username?: string; feedbackScore?: number; feedbackPercentage?: number };
  topRated: boolean;
  available?: { status?: string; quantity?: number; sold?: number };
  aspects: { name: string; value: string }[];
  description?: string;
  categoryPath?: string;
  location?: { city?: string; state?: string; country?: string };
  brand?: string;
  mpn?: string;
  gtin?: string;
  epid?: string;
  imageCount: number;
  fetchedAt: string;
}
