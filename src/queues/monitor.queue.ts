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

/**
 * Cap on the queue's events stream. Passed as `streams.events.maxLen` below,
 * but BullMQ keeps that cap in the queue's shared meta hash, and any process
 * that opens `monitor-queue` with default options (Bull Board, an ad-hoc
 * script) rewrites it to 10,000 (R-12). The periodic trim enforces it anyway.
 */
const EVENTS_MAX_LEN = 1000;

/** How often finished jobs are swept and the events stream trimmed. */
const MAINTENANCE_INTERVAL_MS = parseInt(
  process.env.QUEUE_MAINTENANCE_INTERVAL_MS || String(6 * 60 * 60 * 1000)
);

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
 *
 * With an offset, BullMQ schedules the first job at the next slot plus the
 * offset, 0-2 intervals away, instead of immediately. Activation therefore
 * queues its own immediate run (see addMonitorJob's `runNow`).
 */
function schedulerOffset(monitorId: string, interval: number): number {
  const digest = createHash('sha1').update(monitorId).digest();
  // 32 bits of the digest is ample spread and stays well inside Number range.
  return digest.readUInt32BE(0) % Math.max(interval, 1);
}

/**
 * Id prefix for the one-off run queued on activation. Scheduler jobs are
 * `repeat:<schedulerId>:<millis>`; these are `now:<schedulerId>:<millis>`, so
 * they never collide with a scheduler slot (or with a retained completed job
 * of the same slot, which BullMQ would treat as a duplicate and drop).
 */
const RUN_NOW_PREFIX = 'now:';

export class MonitorQueue {
  private queue: Queue;

  constructor(redis: Redis) {
    this.queue = new Queue('monitor-queue', {
      connection: bullMQRedisConnection,
      defaultJobOptions: { ...JOB_OPTIONS },
      // Default is 10,000 events (~1.4MB in production for a queue with two
      // monitors). Nothing consumes this stream, so keep a short tail.
      streams: { events: { maxLen: EVENTS_MAX_LEN } },
    });
  }

  /**
   * Create or replace the monitor's scheduler.
   *
   * @param runNow also queue one immediate run. Activation needs it: the
   *   scheduler's first slot is up to two intervals away, and the first run is
   *   the baseline every later run is diffed against, so without it listings
   *   posted in that gap were never reported (R-1). Boot reconciliation passes
   *   false so a restart does not fire every monitor at once.
   */
  async addMonitorJob(
    monitorId: string,
    interval: number = parseInt(process.env.MONITOR_INTERVAL || '7200000'),
    { runNow = false }: { runNow?: boolean } = {}
  ) {
    try {
      // Create a scheduler ID that's consistent and unique for this monitor
      const schedulerId = `monitor:${monitorId}`;

      // No removeMonitorJob first: upsertJobScheduler is called with
      // override: true internally, so it replaces the scheduler and its next
      // delayed job atomically. The old remove-then-add cost a full queue scan
      // on every call and briefly left the monitor unscheduled.

      // Use upsertJobScheduler to create or update the job scheduler
      const upsert = () =>
        this.queue.upsertJobScheduler(
          schedulerId,
          { every: interval, offset: schedulerOffset(monitorId, interval) },
          {
            name: schedulerId,
            data: { monitorId },
            opts: { ...JOB_OPTIONS },
          }
        );
      let firstJob = await upsert();

      // BullMQ skips a job whose id already exists. Scheduler job ids are the
      // slot (`repeat:<schedulerId>:<millis>`), and finished jobs are now kept
      // for a while (JOB_RETENTION), so if the slot's job already ran early (a
      // manual promote) the upsert stores the scheduler but queues nothing, and
      // the monitor never runs again (R-21). Drop the finished job and retry;
      // BullMQ refuses to remove a scheduler's current job, so the scheduler
      // goes first.
      if (firstJob?.id) {
        const state = await this.queue.getJobState(firstJob.id);
        if (state === 'completed' || state === 'failed') {
          await this.queue.removeJobScheduler(schedulerId);
          await this.queue.remove(firstJob.id);
          firstJob = await upsert();
          logger.warn('queue.scheduler.slot_reused', { monitorId, jobId: firstJob?.id });
        }
      }

      if (runNow) {
        await this.queue.add(
          schedulerId,
          { monitorId },
          { ...JOB_OPTIONS, jobId: `${RUN_NOW_PREFIX}${schedulerId}:${Date.now()}` }
        );
      }

      logger.debug('queue.scheduler.upserted', { monitorId, interval, runNow });
      return firstJob;
    } catch (error) {
      logger.error('queue.scheduler.upsert_failed', { monitorId, error });
      throw error;
    }
  }

  /**
   * Whether the monitor already has a scheduler with this interval and its
   * next run is still queued. Boot reconciliation leaves such a monitor alone:
   * re-upserting recomputes the next slot from "now" and, when the current
   * slot has started but its offset has not elapsed, drops the pending run
   * (R-18).
   */
  async isScheduled(monitorId: string, interval: number): Promise<boolean> {
    const schedulerId = `monitor:${monitorId}`;
    const scheduler = await this.queue.getJobScheduler(schedulerId);
    if (!scheduler?.next || Number(scheduler.every) !== interval) return false;

    const next = await this.queue.getJob(`repeat:${schedulerId}:${scheduler.next}`);
    if (!next) return false;
    const state = await next.getState();
    return ['delayed', 'waiting', 'active', 'prioritized'].includes(state);
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
   * BullMQ names scheduler jobs `repeat:<schedulerId>:<millis>`; activation
   * runs are `now:<schedulerId>:<millis>`.
   */
  private async removePendingJobsWithRetry(
    monitorId: string,
    schedulerId: string,
    maxRetries: number = 3
  ) {
    const prefixes = [`repeat:${schedulerId}:`, `${RUN_NOW_PREFIX}${schedulerId}:`];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let allClear = true;

      // Only the short waiting/active lists, not the whole queue, and ids only.
      const [waiting, active] = await Promise.all([
        this.queue.getRanges(['waiting'], 0, -1),
        this.queue.getRanges(['active'], 0, -1),
      ]);

      const candidates = [...waiting, ...active].filter(
        (id): id is string =>
          typeof id === 'string' && prefixes.some((prefix) => id.startsWith(prefix))
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
   * Trim the events stream to EVENTS_MAX_LEN (approximately: BullMQ uses
   * `XTRIM MAXLEN ~`), whatever cap the queue meta currently holds.
   */
  async trimEvents(): Promise<void> {
    try {
      await this.queue.trimEvents(EVENTS_MAX_LEN);
    } catch (error) {
      logger.error('queue.trim_events_error', { error });
    }
  }

  /**
   * Sweep finished jobs and trim the events stream now and then, not only at
   * boot. Returns the timer; unref() keeps it from holding the process open.
   */
  startPeriodicMaintenance(): NodeJS.Timeout {
    const timer = setInterval(() => {
      void this.cleanFinishedJobs().then(() => this.trimEvents());
    }, MAINTENANCE_INTERVAL_MS);

    timer.unref();
    return timer;
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
