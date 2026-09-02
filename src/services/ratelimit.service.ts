// src/services/ratelimit.service.ts
import { Redis } from 'ioredis';
import { RateLimitError } from '../utils/errors';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

/**
 * Atomically increment a fixed-window counter and report the result.
 *
 * Replaces the previous GET -> INCR -> TTL -> EXPIRE sequence, which cost four
 * sequential Redis round trips per check and was not atomic: a crash between
 * INCR and EXPIRE left a counter with no TTL, permanently locking the user out
 * of that window.
 *
 * Returns [count, allowed]: the counter is only incremented when it is below
 * the limit, so a rejected request does not push the window further out.
 */
const INCR_WITH_LIMIT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if current >= limit then
  return {current, 0}
end
local updated = redis.call('INCR', KEYS[1])
if updated == 1 then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return {updated, 1}
`;

/** How long cached per-user limits stay valid. */
const LIMIT_CACHE_TTL_MS = 5 * 60 * 1000;

interface UserLimits {
  maxActiveMonitors: number;
  maxApiCallsPerHour: number;
  maxNotificationsPerDay: number;
}

export class RateLimitService {
  /**
   * Per-user limit cache. These three integers change rarely (only when a plan
   * is adjusted) but were previously read with a full `SELECT * FROM "User"`
   * on every single API request.
   */
  private limitCache = new Map<string, { limits: UserLimits; expiresAt: number }>();

  constructor(private redis: Redis) {
    this.redis.defineCommand('incrWithLimit', {
      numberOfKeys: 1,
      lua: INCR_WITH_LIMIT,
    });
  }

  /**
   * Increment a fixed-window counter in a single round trip.
   * @returns true when the request is within the limit
   */
  private async consume(key: string, limit: number, ttlSeconds: number): Promise<boolean> {
    try {
      const [, allowed] = (await (this.redis as any).incrWithLimit(
        key,
        limit,
        ttlSeconds
      )) as [number, number];
      return allowed === 1;
    } catch (error) {
      // Fail open: a Redis blip should not take the API down. The counter is a
      // guard rail, not a correctness requirement.
      logger.error('ratelimit.redis_failed', { key, error });
      return true;
    }
  }

  /** Seconds remaining until the next UTC-local midnight. */
  private secondsUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return Math.floor((midnight.getTime() - now.getTime()) / 1000);
  }

  /**
   * Read the three per-user limits, cached for LIMIT_CACHE_TTL_MS.
   * Selects only the three columns rather than the whole row.
   */
  private async getUserLimits(userId: string): Promise<UserLimits> {
    const cached = this.limitCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.limits;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        maxActiveMonitors: true,
        maxApiCallsPerHour: true,
        maxNotificationsPerDay: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    this.limitCache.set(userId, {
      limits: user,
      expiresAt: Date.now() + LIMIT_CACHE_TTL_MS,
    });

    return user;
  }

  /** Drop a cached limit set, e.g. after an admin changes a user's plan. */
  invalidateUserLimits(userId: string): void {
    this.limitCache.delete(userId);
  }

  async validateUserMonitorLimit(userId: string): Promise<void> {
    const [limits, activeMonitorsCount] = await Promise.all([
      this.getUserLimits(userId),
      prisma.monitor.count({
        where: {
          userId,
          status: 'active',
        },
      }),
    ]);

    if (activeMonitorsCount >= limits.maxActiveMonitors) {
      throw new RateLimitError(
        `You have reached the maximum limit of ${limits.maxActiveMonitors} active monitors. Please deactivate or delete an existing monitor before creating a new one.`
      );
    }
  }

  /**
   * Check notification rate limits for a user.
   *
   * Note: this only consumes from the daily budget. Incrementing the monitor's
   * own notificationCount is the caller's job -- it used to happen here with an
   * updateMany across every monitor the user owned.
   */
  async checkNotificationLimit(
    userId: string,
    _notificationType: string
  ): Promise<boolean> {
    const { maxNotificationsPerDay } = await this.getUserLimits(userId);
    return this.consume(
      `notification:${userId}:daily`,
      maxNotificationsPerDay,
      this.secondsUntilMidnight()
    );
  }

  /**
   * Check API rate limits for a user.
   */
  async checkApiRateLimit(userId: string): Promise<boolean> {
    const { maxApiCallsPerHour } = await this.getUserLimits(userId);
    return this.consume(`api:${userId}:hourly`, maxApiCallsPerHour, 60 * 60);
  }

  /**
   * Check monitor toggle rate limits for a user
   * Prevents rapid switching of monitor status
   */
  async checkMonitorToggleLimit(userId: string): Promise<boolean> {
    const maxToggles = 10; // 10 toggles per minute
    return this.consume(`monitor:toggle:${userId}:minute`, maxToggles, 60);
  }

  /**
   * Track API calls for a specific monitor
   */
  async trackMonitorApiCall(monitorId: string): Promise<void> {
    await prisma.monitor.update({
      where: { id: monitorId },
      data: { apiCallCount: { increment: 1 } },
    });
  }
}
