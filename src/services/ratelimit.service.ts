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
}