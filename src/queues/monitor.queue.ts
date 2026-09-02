import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { bullMQRedisConnection } from '../config/redis.config';
import { logger } from '../utils/logger';

/**
 * Job retention. `removeOnFail: false` (the previous setting) meant every
 * failed job hash was kept forever: production accumulated 2,414 of them,
 * 99% of all Redis keys and ~2.5MB of stacktraces, most from a single
 * deleted monitor whose scheduler kept firing. Keep a bounded, recent
 * window instead -- enough to debug, not enough to grow without limit.
 */
export const JOB_RETENTION = {
  removeOnComplete: { age: 3600, count: 100 }, // 1h / 100 jobs
  removeOnFail: { age: 7 * 24 * 3600, count: 200 }, // 7d / 200 jobs
} as const;

const JOB_OPTIONS = {
  ...JOB_RETENTION,
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
} as const;

export class MonitorQueue {
  private queue: Queue;

  constructor(redis: Redis) {
    this.queue = new Queue('monitor-queue', {
      connection: bullMQRedisConnection,
      defaultJobOptions: { ...JOB_OPTIONS },
      // Default is 10,000 events (~1.4MB in production for a queue with two
      // monitors). Nothing consumes this stream, so keep a short tail.
      streams: { events: { maxLen: 1000 } },
    });
  }

  async addMonitorJob(
    monitorId: string,
    interval: number = parseInt(process.env.MONITOR_INTERVAL || '7200000')
  ) {
    try {
      // First ensure no existing jobs are running for this monitor
      await this.removeMonitorJob(monitorId);

      // Create a scheduler ID that's consistent and unique for this monitor
      const schedulerId = `monitor:${monitorId}`;

      // Use upsertJobScheduler to create or update the job scheduler
      const firstJob = await this.queue.upsertJobScheduler(
        schedulerId,
        { every: interval },
        {
          name: schedulerId,
          data: { monitorId },
          opts: { ...JOB_OPTIONS },
        }
      );

      logger.debug('queue.scheduler.upserted', { monitorId, interval });
      return firstJob;
    } catch (error) {
      logger.error('queue.scheduler.upsert_failed', { monitorId, error });
      throw error;
    }
  }

  async removeMonitorJob(monitorId: string) {
    const schedulerId = `monitor:${monitorId}`;

    try {
      // Step 1: Remove the job scheduler
      const removed = await this.queue.removeJobScheduler(schedulerId);

      logger.debug('queue.scheduler.removed', { monitorId, found: !!removed });

      // Step 2: Clean up pending jobs with retry logic for race conditions
      await this.removePendingJobsWithRetry(monitorId, schedulerId);

      return removed;
    } catch (error) {

      // Don't throw for "not found" errors or lock conflicts - these are expected
      if (error instanceof Error &&
          (error.message.includes('could not be removed because it is locked') ||
           error.message.includes('not found'))) {
        logger.debug('queue.scheduler.remove_skipped', { monitorId });
        return false;
      }

      logger.error('queue.scheduler.remove_failed', { monitorId, error });
      throw error;
    }
  }

  private async removePendingJobsWithRetry(monitorId: string, schedulerId: string, maxRetries: number = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const pendingJobs = await this.queue.getJobs([
          'waiting',
          'active',
          'delayed',
        ]);

        for (const job of pendingJobs) {
          if (
            job.name === schedulerId ||
            (job.data && job.data.monitorId === monitorId)
          ) {
            try {
              await job.remove();
              logger.debug('queue.job.removed', { monitorId, jobId: job.id });
            } catch (jobError) {
              // Handle individual job removal errors
              if (jobError instanceof Error &&
                  jobError.message.includes('could not be removed because it is locked')) {
                logger.debug('queue.job.locked', { jobId: job.id, attempt, maxRetries });

                if (attempt === maxRetries) {
                  logger.warn('queue.job.still_locked', { jobId: job.id, monitorId });
                } else {
                  // Wait before retry with exponential backoff
                  await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                  throw jobError; // Retry the entire operation
                }
              } else {
                throw jobError;
              }
            }
          }
        }

        // If we get here, all jobs were processed successfully
        break;

      } catch (error) {
        if (attempt === maxRetries) {
          logger.warn('queue.job.cleanup_incomplete', { monitorId, maxRetries });
          break;
        }
        // Continue to next attempt
      }
    }
  }

  /**
   * Drop finished jobs older than the retention window.
   *
   * `removeOnFail`/`removeOnComplete` only apply to jobs created after this
   * change, so the pre-existing backlog needs sweeping explicitly. Safe to
   * call repeatedly: it removes only terminal jobs (failed/completed), never
   * waiting, active or delayed ones.
   *
   * @returns the number of jobs removed, by state
   */
  async cleanFinishedJobs(
    graceMs: number = JOB_RETENTION.removeOnFail.age * 1000,
    limit = 5000
  ): Promise<{ failed: number; completed: number }> {
    const removed = { failed: 0, completed: 0 };

    try {
      removed.failed = (await this.queue.clean(graceMs, limit, 'failed')).length;
    } catch (error) {
      logger.error('queue.clean.failed_jobs_error', { error });
    }

    try {
      const completedGrace = JOB_RETENTION.removeOnComplete.age * 1000;
      removed.completed = (
        await this.queue.clean(completedGrace, limit, 'completed')
      ).length;
    } catch (error) {
      logger.error('queue.clean.completed_jobs_error', { error });
    }

    if (removed.failed || removed.completed) {
      logger.info('queue.cleaned', removed);
    }

    return removed;
  }

  /**
   * Get all job schedulers from the queue
   * Used for cleanup of orphaned schedulers
   */
  async getJobSchedulers() {
    try {
      // Get all schedulers with a reasonable limit
      const schedulers = await this.queue.getJobSchedulers(0, 1000, true);
      return schedulers;
    } catch (error) {
      logger.error('queue.schedulers.list_failed', { error });
      return [];
    }
  }
}
