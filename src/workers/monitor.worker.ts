import { Worker } from 'bullmq';
import { EbayService } from '../services/ebay.service';
import { CacheService } from '../services/cache.service';
import { ComparisonService } from '../services/comparison.service';
import { BackoffService } from '../services/backoff.service';
import { prisma } from '../lib/prisma';
import { Job } from 'bullmq';
import { bullMQRedisConnection } from '../config/redis.config';
import { TransformedEbayResults } from '../types/ebay.types';
import { logger } from '../utils/logger';
import { monitorSearchParams } from '../utils/search-key';

export class MonitorWorker {
  private worker: Worker;
  constructor(
    private ebayService: EbayService,
    private cacheService: CacheService,
    private comparisonService: ComparisonService,
    private backoffService: BackoffService
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
    const startedAt = Date.now();

    // Only the columns this job actually uses. The default selection pulled
    // every column, including four Postgres text arrays, on every run.
    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      select: {
        userId: true,
        status: true,
        interval: true,
        keywords: true,
        excludedKeywords: true,
        minPrice: true,
        maxPrice: true,
        conditions: true,
        sellers: true,
      },
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

    // A monitor that keeps coming back empty polls less often. The job still
    // fires on its configured interval; this skips the eBay call itself, and
    // refreshes the snapshot's TTL so it outlives the backoff.
    if (await this.backoffService.shouldSkip(monitorId)) {
      await this.cacheService.touchResults(monitorId);
      logger.debug('worker.skip', { monitorId, reason: 'backoff' });
      return;
    }

    try {
      const previousResults = await this.cacheService.getResults(monitorId);

      // Same params the scheduler phase was derived from (monitor.queue.ts).
      const newResults = await this.ebayService.searchItems(monitorSearchParams(monitor));

      // Project to the fields the comparison and the email actually use.
      // Storing the raw itemSummaries persisted every field eBay returned,
      // twice over (once raw, once projected), for 24h per monitor.
      const transformedResults: TransformedEbayResults = {
        items: (newResults.itemSummaries || []).map((item) => ({
          itemId: item.itemId,
          title: item.title,
          price: item.price,
          condition: item.condition,
          seller: {
            username: item.seller?.username,
            feedbackScore: item.seller?.feedbackScore,
          },
          itemWebUrl: item.itemWebUrl,
          image: item.image ? { imageUrl: item.image.imageUrl } : undefined,
        })),
        total: newResults.total,
        timestamp: new Date(),
      };

      await this.cacheService.storeResults(monitorId, transformedResults);

      // Empty result sets extend the effective interval; any hit resets it.
      if (transformedResults.items.length === 0) {
        const { emptyStreak, factor } = await this.backoffService.recordEmpty(
          monitorId,
          monitor.interval,
          startedAt
        );
        if (factor > 1) {
          logger.info('monitor.backoff', {
            monitorId,
            emptyStreak,
            factor,
            effectiveIntervalMs: monitor.interval * factor,
          });
        }
      } else {
        await this.backoffService.recordHit(monitorId);
      }

      if (previousResults) {
        await this.comparisonService.compareResults(
          monitorId,
          monitor.userId,
          monitor.keywords.join(' '),
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

      // One line per run. ebay.search can't carry these: searchItems doesn't
      // know the monitor, and identical searches share one call.
      logger.info('monitor.run', {
        monitorId,
        durationMs: Date.now() - startedAt,
        results: transformedResults.items.length,
        baseline: !previousResults,
      });
    } catch (error) {
      logger.error('worker.job_error', { monitorId, durationMs: Date.now() - startedAt, error });
      throw error;
    }
  }
}