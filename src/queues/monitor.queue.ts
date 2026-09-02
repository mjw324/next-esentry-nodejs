import { Queue } from 'bullmq';
import { createHash } from 'crypto';
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

/**
 * Spread scheduler fire times across the interval.
 *
 * BullMQ aligns `every: N` to epoch multiples, so every monitor sharing an
 * interval fires in the same instant. Production shows it exactly: the 2-hour
 * monitor's next run is 02:00:00.000Z and the 5-minute one's is 02:20:00.000Z.
 * With many monitors that is a synchronised burst against eBay, Postgres and
 * the worker's concurrency limit, followed by a quiet stretch.
 *
 * A stable per-monitor offset derived from its id keeps each monitor's own
 * cadence exact while decorrelating it from its neighbours. Deterministic, so
 * a restart or reschedule does not move a monitor to a different slot.
 */
function schedulerOffset(monitorId: string, interval: number): number {
  const digest = createHash('sha1').update(monitorId).digest();
  // 32 bits of the digest is ample spread and stays well inside Number range.
  return digest.readUInt32BE(0) % Math.max(interval, 1);
}

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
      // Create a scheduler ID that's consistent and unique for this monitor
      const schedulerId = `monitor:${monitorId}`;

      // No removeMonitorJob first: upsertJobScheduler is called with
      // override: true internally, so it replaces the scheduler and its next
      // delayed job atomically. The old remove-then-add cost a full queue scan
      // on every call and briefly left the monitor unscheduled.

      // Use upsertJobScheduler to create or update the job scheduler
      const firstJob = await this.queue.upsertJobScheduler(
        schedulerId,
        { every: interval, offset: schedulerOffset(monitorId, interval) },
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

  /**
   * Remove any still-queued job belonging to a monitor.
   *
   * This used to call `getJobs(['waiting','active','delayed'])`, which BullMQ
   * implements as one HGETALL per job in the queue (Job.fromId for every id)
   * before filtering in JavaScript -- O(queue depth) per toggle, retried up to
   * three times, so every user's toggle paid for every other user's pending
   * jobs.
   *
   * `removeJobScheduler` already deletes the scheduler's next delayed job
   * atomically in Lua, so the only job that can remain is one already promoted
   * to waiting/active. Those are found by id prefix instead of by scanning:
   * BullMQ names scheduler jobs `repeat:<schedulerId>:<millis>`.
   */
  private async removePendingJobsWithRetry(
    monitorId: string,
    schedulerId: string,
    maxRetries: number = 3
  ) {
    const prefix = `repeat:${schedulerId}:`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let allClear = true;

      // Only the short waiting/active lists, not the whole queue, and ids only.
      const [waiting, active] = await Promise.all([
        this.queue.getRanges(['waiting'], 0, -1),
        this.queue.getRanges(['active'], 0, -1),
      ]);

      const candidates = [...waiting, ...active].filter(
        (id): id is string => typeof id === 'string' && id.startsWith(prefix)
      );

      for (const jobId of candidates) {
        try {
          const job = await this.queue.getJob(jobId);
          if (!job) continue;
          await job.remove();
          logger.debug('queue.job.removed', { monitorId, jobId });
        } catch (jobError) {
          const locked =
            jobError instanceof Error &&
            jobError.message.includes('could not be removed because it is locked');

          if (!locked) {
            logger.error('queue.job.remove_failed', { monitorId, jobId, error: jobError });
            continue;
          }

          allClear = false;
          logger.debug('queue.job.locked', { jobId, attempt, maxRetries });
        }
      }

      if (allClear) return;

      if (attempt === maxRetries) {
        // A locked job is held by a running worker; it will finish on its own
        // and the worker's inactive-monitor guard makes the outcome harmless.
        logger.warn('queue.job.cleanup_incomplete', { monitorId, maxRetries });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
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
