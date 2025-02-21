import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { bullMQRedisConnection } from '../config/redis.config';

export class MonitorQueue {
  private queue: Queue;

  constructor(redis: Redis) {
    this.queue = new Queue('monitor-queue', {
      connection: bullMQRedisConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      }
    });
  }

  async addMonitorJob(monitorId: string, interval: number = 1800000) {
    await this.queue.add(
      `monitor:${monitorId}`,
      { monitorId },
      {
        repeat: {
          every: interval,
        },
        removeOnComplete: true,
        removeOnFail: false,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      }
    );
  }

  async removeMonitorJob(monitorId: string) {
    const repeatableJobs = await this.queue.getJobSchedulers();
    const job = repeatableJobs.find(job => job.id === `monitor:${monitorId}`);
    if (job) {
      await this.queue.removeJobScheduler(job.key);
    }
  }
}