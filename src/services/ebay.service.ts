// src/services/ebay.service.ts
import axios from 'axios';
import { ebayConfig } from '../config/ebay.config';
import { EbaySearchParams, EbaySearchResults, EbayItem } from '../types/ebay.types';
import { EbayAuthService } from './ebay-auth.service';

export class EbayService {
  
  constructor(private authService: EbayAuthService) { }

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
  

  private buildFilterString(params: EbaySearchParams): string {
    const filters: string[] = ['priceCurrency:USD'];

    // Add price filter
    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      const priceFilter = `price:[${params.minPrice || ''}..${params.maxPrice || ''}]`;
      filters.push(priceFilter);
    }

    // Add condition filter
    if (params.conditions.length > 0) {
      filters.push(`conditions:{${params.conditions.join('|')}}`);
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
      warnings: data.warnings?.map(w => ({
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
