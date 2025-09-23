import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { bullMQRedisConnection } from '../config/redis.config';

export class MaintenanceQueue {
  private queue: Queue;

  constructor(redis: Redis) {
    this.queue = new Queue('maintenance-queue', {
      connection: bullMQRedisConnection,
      defaultJobOptions: {
        removeOnComplete: 5,
        removeOnFail: 10,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      }
    });
  }

  async scheduleInactiveMonitorCleanup() {
    try {
      const schedulerId = 'inactive-monitor-cleanup';

      await this.queue.upsertJobScheduler(
        schedulerId,
        { every: 24 * 60 * 60 * 1000 }, // Run daily (24 hours in milliseconds)
        {
          name: schedulerId,
          data: { type: 'disable-inactive-monitors' },
          opts: {
            removeOnComplete: 5,
            removeOnFail: 10,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          }
        }
      );

      console.log('Scheduled daily inactive monitor cleanup job');
    } catch (error) {
      console.error('Error scheduling inactive monitor cleanup:', error);
      throw error;
    }
  }

  async scheduleOrphanedJobCleanup() {
    try {
      const schedulerId = 'orphaned-job-cleanup';

      await this.queue.upsertJobScheduler(
        schedulerId,
        { every: 12 * 60 * 60 * 1000 }, // Run twice daily (12 hours in milliseconds)
        {
          name: schedulerId,
          data: { type: 'cleanup-orphaned-jobs' },
          opts: {
            removeOnComplete: 5,
            removeOnFail: 10,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          }
        }
      );

      console.log('Scheduled orphaned job cleanup job');
    } catch (error) {
      console.error('Error scheduling orphaned job cleanup:', error);
      throw error;
    }
  }

  async scheduleAllMaintenanceTasks() {
    await this.scheduleInactiveMonitorCleanup();
    await this.scheduleOrphanedJobCleanup();
  }

  async removeInactiveMonitorCleanup() {
    try {
      const schedulerId = 'inactive-monitor-cleanup';
      const removed = await this.queue.removeJobScheduler(schedulerId);

      if (removed) {
        console.log('Removed inactive monitor cleanup scheduler');
      } else {
        console.log('No inactive monitor cleanup scheduler found to remove');
      }

      return removed;
    } catch (error) {
      console.error('Error removing inactive monitor cleanup scheduler:', error);
      throw error;
    }
  }
}