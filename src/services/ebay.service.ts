// src/services/ebay.service.ts
import axios from 'axios';
import { ebayConfig } from '../config/ebay';
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
      console.log('eBay API response:', response.data);
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
}
