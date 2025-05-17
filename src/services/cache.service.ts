import { Redis } from 'ioredis';
import { TransformedEbayResults } from '../types/ebay.types';

export class CacheService {
    private readonly RESULT_PREFIX = 'monitor:results:';
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
}