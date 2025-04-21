import { Worker, ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { EbayService } from '../services/ebay.service';
import { CacheService } from '../services/cache.service';
import { ComparisonService } from '../services/comparison.service';
import { prisma } from '../lib/prisma';
import { Job } from 'bullmq';
import { bullMQRedisConnection } from '../config/redis.config';

export class MonitorWorker {
  private worker: Worker;
  constructor(
    private ebayService: EbayService,
    private cacheService: CacheService,
    private comparisonService: ComparisonService,
    redis: Redis
  ) {
    this.worker = new Worker(
      'monitor-queue',
      this.processJob.bind(this),
      { 
        connection: bullMQRedisConnection,
        concurrency: 5, // Adjust concurrency as needed
        limiter: { // Maximum of 10 jobs per second to process
          max: 10, 
          duration: 1000
        }
      }
    );
    this.worker.on('error', err => {
      console.error('Monitor worker error:', err);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err);
    });
  }

  private async processJob(job: Job): Promise<void> {
    const { monitorId } = job.data;

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId }
    });

    if (!monitor) {
      throw new Error('Monitor not found');
    }

    // Check if monitor is still active before processing
    if (monitor.status !== 'active') {
      console.log(`Monitor ${monitorId} is now inactive, skipping job`);
      return; // Skip processing for inactive monitors
    }

    try {
      const previousResults = await this.cacheService.getResults(monitorId);

      const newResults = await this.ebayService.searchItems({
        keywords: monitor.keywords,
        excludedKeywords: monitor.excludedKeywords,
        minPrice: monitor.minPrice || undefined,
        maxPrice: monitor.maxPrice || undefined,
        conditions: monitor.conditions,
        sellers: monitor.sellers,
      });

      // Transform eBay results to our internal format before caching
      const transformedResults = {
        items: (newResults.itemSummaries || []).map(item => ({
          itemId: item.itemId,
          title: item.title,
          price: parseFloat(item.price.value),
          condition: item.condition,
          seller: item.seller.username,
          link: item.itemWebUrl,
          timestamp: new Date()
        })),
        total: newResults.total,
        timestamp: new Date(),
        href: newResults.href,
        limit: newResults.limit,
        offset: newResults.offset, 
        itemSummaries: newResults.itemSummaries,
      };

      await this.cacheService.storeResults(monitorId, transformedResults);

      if (previousResults) {
        await this.comparisonService.compareResults(
          monitorId,
          monitor.userId,
          previousResults,
          transformedResults
        );
      }

      await prisma.monitor.update({
        where: { id: monitorId },
        data: {
          lastCheckTime: new Date(),
          lastResultCount: transformedResults.items.length,
          apiCallCount: { increment: 1 },
        },
      });
    } catch (error) {
      console.error(`Error processing monitor ${monitorId}:`, error);
      throw error;
    }
  }
}