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
      },
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
          opts: {
            removeOnComplete: true,
            removeOnFail: false,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          },
        }
      );

      console.log(`Job scheduler created/updated for monitor: ${monitorId}`);
      return firstJob;
    } catch (error) {
      console.error(
        `Error creating job scheduler for monitor ${monitorId}:`,
        error
      );
      throw error;
    }
  }

  async removeMonitorJob(monitorId: string) {
    try {
      // The scheduler ID matches the pattern we used when creating it
      const schedulerId = `monitor:${monitorId}`;

      const removed = await this.queue.removeJobScheduler(schedulerId);

      console.log(
        `Job scheduler removal attempt for ${schedulerId}: ${removed ? 'Successful' : 'Not found'}`
      );

      if (removed) {
        console.log(`Job scheduler removed for monitor: ${monitorId}`);
      } else {
        console.log(`No job scheduler found for monitor: ${monitorId}`);
      }

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
          await job.remove();
          console.log(`Removed pending job for monitor: ${monitorId}`);
        }
      }

      const schedulers = await this.queue.getJobSchedulers(0, 9, true);
      console.log('Current job schedulers:', schedulers);

      return removed;
    } catch (error) {
      console.error(
        `Error removing job scheduler for monitor ${monitorId}:`,
        error
      );
      throw error;
    }
  }
}
