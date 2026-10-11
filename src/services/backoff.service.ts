import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

/**
 * Adaptive polling for monitors that keep coming back empty.
 *
 * Production motivation: one monitor had made 9,396 eBay calls and returned
 * zero items across its entire life; another 2,492 calls since February, also
 * zero. Between them that is ~293 Browse calls a day -- 100% of current eBay
 * spend -- producing no notifications. Meanwhile the per-user cap of 5 active
 * monitors at a 5-minute floor allows 7,200 calls/day for five users, above
 * eBay's default 5,000/day application quota.
 *
 * Rather than rewriting the BullMQ scheduler interval (stateful, and racy
 * against toggles), the job keeps firing on its configured interval and this
 * service decides whether the run does any eBay work. State lives in Redis, so
 * no schema change is needed; losing it just means a monitor resumes at its
 * base interval, which is safe.
 */

/** Consecutive empty runs before backoff begins, and per doubling thereafter. */
const EMPTY_RUNS_PER_STEP = 5;
/** Never stretch a monitor's effective interval beyond this multiple. */
const MAX_FACTOR = 12;
/** Nor beyond this absolute gap, however long the base interval is. */
const MAX_EFFECTIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * Slack, as a fraction of the base interval, so a run that started late
 * (slow eBay, a retry, a busy worker) does not push the next eligible time
 * past the next scheduled fire. A fixed 1 s skipped the next run of every
 * empty monitor whenever a run took more than about a second (R-22).
 */
const BOUNDARY_SLACK_FRACTION = 0.5;
/** Backoff state outlives a long sleep but not an abandoned monitor. */
const STATE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface BackoffState {
  emptyStreak: number;
  nextEligibleAt: number;
}

export class BackoffService {
  private readonly PREFIX = 'monitor:backoff:';

  constructor(private redis: Redis) {}

  private key(monitorId: string): string {
    return `${this.PREFIX}${monitorId}`;
  }

  /**
   * Multiplier applied to the base interval for a given empty streak.
   * Doubles every EMPTY_RUNS_PER_STEP empty runs: 1, 2, 4, 8, ... capped.
   */
  static factorFor(emptyStreak: number): number {
    if (emptyStreak < EMPTY_RUNS_PER_STEP) return 1;
    const steps = Math.floor(emptyStreak / EMPTY_RUNS_PER_STEP);
    return Math.min(2 ** steps, MAX_FACTOR);
  }

  /**
   * Whether this run should skip the eBay call because the monitor is in
   * backoff. Reads one hash; failures fail open (the run proceeds).
   */
  async shouldSkip(monitorId: string): Promise<boolean> {
    try {
      const nextEligibleAt = await this.redis.hget(this.key(monitorId), 'nextEligibleAt');
      if (!nextEligibleAt) return false;
      return Date.now() < Number(nextEligibleAt);
    } catch (error) {
      logger.error('backoff.read_failed', { monitorId, error });
      return false;
    }
  }

  /**
   * Record that a run produced results: clears any backoff so the monitor
   * returns to its configured interval immediately.
   */
  async recordHit(monitorId: string): Promise<void> {
    try {
      await this.redis.del(this.key(monitorId));
    } catch (error) {
      logger.error('backoff.clear_failed', { monitorId, error });
    }
  }

  /**
   * Record an empty run and extend the next eligible time.
   * @param startedAt when the run started; the schedule counts from there,
   *   not from when the (possibly slow) eBay call came back
   * @returns the new streak and the factor now in force
   */
  async recordEmpty(
    monitorId: string,
    intervalMs: number,
    startedAt: number = Date.now()
  ): Promise<{ emptyStreak: number; factor: number }> {
    try {
      const key = this.key(monitorId);
      const emptyStreak = await this.redis.hincrby(key, 'emptyStreak', 1);
      const factor = BackoffService.factorFor(emptyStreak);

      const effectiveInterval = Math.min(
        intervalMs * factor,
        MAX_EFFECTIVE_INTERVAL_MS
      );
      const nextEligibleAt =
        startedAt + effectiveInterval - intervalMs * BOUNDARY_SLACK_FRACTION;

      await this.redis
        .multi()
        .hset(key, 'nextEligibleAt', nextEligibleAt)
        .expire(key, STATE_TTL_SECONDS)
        .exec();

      return { emptyStreak, factor };
    } catch (error) {
      logger.error('backoff.record_failed', { monitorId, error });
      return { emptyStreak: 0, factor: 1 };
    }
  }

  /**
   * Drop backoff state. Called when a monitor's search terms change or it is
   * toggled, since the previous emptiness says nothing about the new query.
   */
  async reset(monitorId: string): Promise<void> {
    await this.recordHit(monitorId);
  }
}
