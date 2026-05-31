export interface EbayItemImage {
    imageUrl: string;
}

export interface EbayItemPrice {
    value: string;
    currency: string;
}

export interface EbaySeller {
    username: string;
    feedbackPercentage: string;
    feedbackScore: number;
}

export interface EbayItem {
    listingMarketplaceId: any;
    itemId: string;
    title: string;
    price: EbayItemPrice;
    condition: string;
    conditionId: string;
    seller: EbaySeller;
    itemWebUrl: string;
    image: EbayItemImage;
    additionalImages?: EbayItemImage[];
}

export interface EbaySearchResults {
    warnings: any;
    href: string;
    total: number;
    next?: string;
    limit: number;
    offset: number;
    itemSummaries: EbayItem[];
    // Present only when the search is issued with refinement fieldgroups
    // (ASPECT_REFINEMENTS, CONDITION_REFINEMENTS, CATEGORY_REFINEMENTS,
    // BUYING_OPTION_REFINEMENTS). See EbayRefinement below.
    refinement?: EbayRefinement;
}

// ---------------------------------------------------------------------------
// eBay Browse API refinement distributions
// Returned when `fieldgroups` includes the *_REFINEMENTS values. Each entry
// carries a `matchCount` = number of active listings matching that value.
// ---------------------------------------------------------------------------

export interface EbayAspectValueDistribution {
    localizedAspectValue: string;
    matchCount: number;
    refinementHref?: string;
}

export interface EbayAspectDistribution {
    localizedAspectName: string;
    aspectValueDistributions: EbayAspectValueDistribution[];
}

export interface EbayConditionDistribution {
    condition: string;
    conditionId: string;
    matchCount: number;
    refinementHref?: string;
}

export interface EbayBuyingOptionDistribution {
    buyingOption: string;
    matchCount: number;
    refinementHref?: string;
}

export interface EbayCategoryDistribution {
    categoryId: string;
    categoryName: string;
    matchCount: number;
    refinementHref?: string;
}

export interface EbayRefinement {
    aspectDistributions?: EbayAspectDistribution[];
    conditionDistributions?: EbayConditionDistribution[];
    buyingOptionDistributions?: EbayBuyingOptionDistribution[];
    categoryDistributions?: EbayCategoryDistribution[];
    dominantCategoryId?: string;
}

export interface TransformedEbayResults {
    items: { 
      itemId: string;
      title: string;
      price: number;
      condition: string;
      seller: string;
      link: string;
      timestamp: Date;
    }[];
    total: number;
    timestamp: Date;
    href: string;
    limit: number;
    offset: number;
    itemSummaries: EbayItem[];
}

export interface EbaySearchParams {
    keywords: string[];
    excludedKeywords: string[];
    minPrice?: number;
    maxPrice?: number;
    conditions: string[];
    sellers: string[];
}

export interface EbayNotification {
    metadata: {
        topic: string;
        schemaVersion: string;
        deprecated: boolean;
    };
    notification: {
        notificationId: string;
        eventDate: string;
        publishDate: string;
        publishAttemptCount: number;
        data: {
            username: string;
            userId: string;
            eiasToken: string;
        };
    };
}

export interface ChallengeResponse {
    challengeResponse: string;
}

// ===========================================================================
// Active Market Insights feature contracts
// Response shapes for /api/insights/{market,outliers,calibrate}. Built on top
// of EbaySearchParams (the existing monitor param shape) so suggestions map
// directly back onto excludedKeywords / minPrice / maxPrice.
// ===========================================================================

/**
 * Price statistics computed over the listings we actually fetched. These are
 * SAMPLE-BASED — `sampleSize` is the number of prices observed, which may be
 * far smaller than `totalActive`. Never present these as full-population stats.
 */
export interface PriceStats {
    min: number;
    max: number;
    mean: number;
    median: number;
    q1: number;
    q3: number;
    iqr: number;
    sampleSize: number;
    currency: string;
}

export interface ConditionBreakdown {
    condition: string;
    conditionId: string;
    matchCount: number;
}

export interface BuyingOptionSplit {
    buyingOption: string;
    matchCount: number;
}

export interface AspectSummary {
    name: string;
    values: { value: string; matchCount: number }[];
}

/** Phase 1 — a structured snapshot of the current active market. */
export interface MarketSnapshot {
    totalActive: number;
    priceStats: PriceStats | null;
    conditionDistribution: ConditionBreakdown[];
    buyingOptions: BuyingOptionSplit[];
    topAspects: AspectSummary[];
    sampleBased: true;
    sampleSize: number;
}

/** A listing flagged as a price outlier, with the tokens that mark it as noise. */
export interface OutlierListing {
    itemId: string;
    title: string;
    price: number;
    /** Distance of the price from the sample median, in currency units. */
    metric: number;
    /**
     * Why this listing was flagged: 'mad'/'tukey' = robust price-outlier
     * detection (works when noise is a small minority); 'token' = it sits in a
     * price tail and matches an over-represented noise term (catches the
     * bimodal case where accessories are a large fraction).
     */
    method: 'mad' | 'tukey' | 'token';
    /** 'low' = cheap tail (often accessories), 'high' = expensive tail. */
    tail: 'low' | 'high';
    /** Over-represented noise tokens this title matched, if any. */
    matchedTokens: string[];
}

/**
 * A candidate noise term, over-represented in an outlier tail vs the overall
 * result set. `count` = how many of the sampled listings it would remove.
 */
export interface NoiseTerm {
    term: string;
    inOutliers: number;
    inOverall: number;
    count: number;
}

/** Actionable refinements mapping onto the existing EbaySearchParams fields. */
export interface SuggestedRefinements {
    suggestedExcludedKeywords: NoiseTerm[];
    suggestedPriceRange?: { minPrice: number; maxPrice: number };
}

/** Phase 2 — flagged listings plus one-tap recalibration suggestions. */
export interface OutlierResult {
    outlierListings: OutlierListing[];
    suggestedRefinements: SuggestedRefinements;
    sampleSize: number;
}

/** Phase 3 — compact summary for live use on the create-monitor form. */
export interface CalibrationSummary {
    totalActive: number;
    sampleSize: number;
    /** Percentile (0-100) at which the user's maxPrice sits among sampled prices. */
    maxPricePercentile?: number;
    /** Fraction (0-1) of sampled listings that look like noise/accessories. */
    noiseFraction: number;
    topSuggestedExcludedKeywords: NoiseTerm[];
    suggestedPriceRange?: { minPrice: number; maxPrice: number };
}
