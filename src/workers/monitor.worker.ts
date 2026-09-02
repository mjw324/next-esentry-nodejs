import { Worker } from 'bullmq';
import { EbayService } from '../services/ebay.service';
import { CacheService } from '../services/cache.service';
import { ComparisonService } from '../services/comparison.service';
import { prisma } from '../lib/prisma';
import { Job } from 'bullmq';
import { bullMQRedisConnection } from '../config/redis.config';
import { TransformedEbayResults } from '../types/ebay.types';
import { logger } from '../utils/logger';

export class MonitorWorker {
  private worker: Worker;
  constructor(
    private ebayService: EbayService,
    private cacheService: CacheService,
    private comparisonService: ComparisonService
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
    this.worker.on('error', (err) => {
      logger.error('worker.error', { error: err });
    });

    this.worker.on('failed', (job, err) => {
      logger.error('worker.job_failed', {
        jobId: job?.id,
        monitorId: job?.data?.monitorId,
        attemptsMade: job?.attemptsMade,
        error: err,
      });
    });
  }

  private async processJob(job: Job): Promise<void> {
    const { monitorId } = job.data;

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId }
    });

    if (!monitor) {
      logger.debug('worker.skip', { monitorId, reason: 'deleted' });
      return; // Gracefully skip processing for deleted monitors
    }

    // Check if monitor is still active before processing
    if (monitor.status !== 'active') {
      logger.debug('worker.skip', { monitorId, reason: 'inactive' });
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
      const transformedResults: TransformedEbayResults = {
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
      logger.error('worker.job_error', { monitorId, error });
      throw error;
    }
  }
}