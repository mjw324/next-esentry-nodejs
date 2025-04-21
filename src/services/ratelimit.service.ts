// src/services/ratelimit.service.ts
import { Redis } from 'ioredis';
import { RateLimitError } from '../utils/errors';
import { prisma } from '../lib/prisma';

export class RateLimitService {
  constructor(private redis: Redis) {}

  async validateUserMonitorLimit(userId: string): Promise<void> {
    const [user, activeMonitorsCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.monitor.count({
        where: {
          userId,
          status: 'active',
        },
      }),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    if (activeMonitorsCount >= user.maxActiveMonitors) {
      throw new RateLimitError('Maximum number of active monitors reached');
    }
  }

  /**
   * Check notification rate limits for a user
   */
  async checkNotificationLimit(
    userId: string,
    notificationType: string
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new Error('User not found');
    }

    const maxNotifications = user.maxNotificationsPerDay;
    const key = `notification:${userId}:daily`;

    // Get current count from Redis
    const currentCount = await this.redis.get(key);
    const count = currentCount ? parseInt(currentCount) : 0;

    // If count exceeds limit, return false
    if (count >= maxNotifications) {
      return false;
    }

    // Increment count and set expiry if needed
    await this.redis.incr(key);

    // Set TTL to end of day if not already set
    const ttl = await this.redis.ttl(key);
    if (ttl < 0) {
      // Calculate seconds until midnight
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000);

      await this.redis.expire(key, secondsUntilMidnight);
    }

    // Also track per-monitor notification counts
    if (notificationType === 'MONITOR_RESULTS') {
      await prisma.monitor.updateMany({
        where: { userId },
        data: { notificationCount: { increment: 1 } }
      });
    }

    return true;
  }

  /**
   * Check API rate limits for a user
   */
  async checkApiRateLimit(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new Error('User not found');
    }

    const maxCalls = user.maxApiCallsPerHour;
    const key = `api:${userId}:hourly`;
    // TODO: Use cache.service.ts for this operation instead of  directly accessing redis
    // Get current count from Redis
    const currentCount = await this.redis.get(key);
    const count = currentCount ? parseInt(currentCount) : 0;

    // If count exceeds limit, return false
    if (count >= maxCalls) {
      return false;
    }

    // Increment count and set expiry if needed
    await this.redis.incr(key);

    // Set TTL to 1 hour if not already set
    const ttl = await this.redis.ttl(key);
    if (ttl < 0) {
      await this.redis.expire(key, 60 * 60); // 1 hour in seconds
    }

    return true;
  }

  /**
   * Track API calls for a specific monitor
   */
  async trackMonitorApiCall(monitorId: string): Promise<void> {
    await prisma.monitor.update({
      where: { id: monitorId },
      data: { apiCallCount: { increment: 1 } }
    });
  }
}
