import { Redis } from 'ioredis';
import { EbaySearchParams, TransformedEbayResults } from '../types/ebay.types';

export class CacheService {
    private readonly RESULT_PREFIX = 'monitor:results:';
    private readonly INSIGHTS_PREFIX = 'insights:';
    private readonly EXPIRY_TIME = 60 * 60 * 24; // 24 hours

    constructor(private redis: Redis) { }

    async storeResults(monitorId: string, results: TransformedEbayResults): Promise<void> {
        const key = `${this.RESULT_PREFIX}${monitorId}`;
        await this.redis.set(key, JSON.stringify(results), 'EX', this.EXPIRY_TIME);
    }

    async getResults(monitorId: string): Promise<TransformedEbayResults | null> {
        const key = `${this.RESULT_PREFIX}${monitorId}`;
        const results = await this.redis.get(key);
        return results ? JSON.parse(results) : null;
    }

    async clearResults(monitorId: string): Promise<void> {
        const key = `${this.RESULT_PREFIX}${monitorId}`;
        await this.redis.del(key);
    }

    // -----------------------------------------------------------------------
    // Generic short-TTL JSON cache, used by the Active Market Insights feature.
    // Keyed on normalized search params so identical requests reuse one result.
    // -----------------------------------------------------------------------

    async getJSON<T>(key: string): Promise<T | null> {
        const value = await this.redis.get(key);
        return value ? (JSON.parse(value) as T) : null;
    }

    async setJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }

    /**
     * Build a stable cache key for an insights request. Arrays are sorted and
     * lowercased so semantically identical params (different ordering/casing)
     * collapse onto the same key. `namespace` separates the three endpoints
     * (e.g. 'market', 'outliers', 'calibrate').
     */
    buildInsightsKey(namespace: string, params: EbaySearchParams): string {
        const norm = {
            keywords: normalizeArray(params.keywords),
            excludedKeywords: normalizeArray(params.excludedKeywords),
            minPrice: params.minPrice ?? null,
            maxPrice: params.maxPrice ?? null,
            conditions: normalizeArray(params.conditions),
            sellers: normalizeArray(params.sellers),
        };
        return `${this.INSIGHTS_PREFIX}${namespace}:${JSON.stringify(norm)}`;
    }
}

function normalizeArray(values: string[] | undefined): string[] {
    return [...(values ?? [])].map((v) => v.toLowerCase().trim()).filter(Boolean).sort();
}