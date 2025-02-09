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
    href: string;
    total: number;
    next?: string;
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