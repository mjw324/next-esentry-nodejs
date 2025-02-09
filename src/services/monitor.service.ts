import { PrismaClient } from '@prisma/client';
import { CreateMonitorDTO } from '../types/monitor.types';
import { RateLimitService } from './ratelimit.service';
import { MonitorQueue } from '../queues/monitor.queue';

export class MonitorService {
  constructor(
    private prisma: PrismaClient,
    private rateLimitService: RateLimitService,
    private monitorQueue: MonitorQueue
  ) { }

  async createMonitor(userId: string, data: CreateMonitorDTO) {
    // Check rate limits
    await this.rateLimitService.validateUserMonitorLimit(userId);

    // Create monitor in database
    const monitor = await this.prisma.monitor.create({
      data: {
        userId,
        keywords: data.keywords,
        excludedKeywords: data.excludedKeywords || [],
        minPrice: data.minPrice,
        maxPrice: data.maxPrice,
        conditions: data.conditions,
        sellers: data.sellers,
        status: 'inactive', // Monitors are created as inactive by default
      },
    });

    return monitor;
  }

  async activateMonitor(monitorId: string): Promise<void> {
    const monitor = await this.prisma.monitor.findUnique({
      where: { id: monitorId }
    });

    if (!monitor) {
      throw new Error('Monitor not found');
    }

    // Update status
    await this.prisma.monitor.update({
      where: { id: monitorId },
      data: { status: 'active' }
    });

    // Add to queue
    await this.monitorQueue.addMonitorJob(monitorId);
  }
}