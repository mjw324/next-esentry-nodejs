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
    const schedulerId = `monitor:${monitorId}`;

    try {
      // Step 1: Remove the job scheduler
      const removed = await this.queue.removeJobScheduler(schedulerId);

      console.log(
        `Job scheduler removal attempt for ${schedulerId}: ${removed ? 'Successful' : 'Not found'}`
      );

      // Step 2: Clean up pending jobs with retry logic for race conditions
      await this.removePendingJobsWithRetry(monitorId, schedulerId);

      const schedulers = await this.queue.getJobSchedulers(0, 9, true);
      console.log('Current job schedulers:', schedulers);

      return removed;
    } catch (error) {
      console.error(
        `Error removing job scheduler for monitor ${monitorId}:`,
        error
      );

      // Don't throw for "not found" errors or lock conflicts - these are expected
      if (error instanceof Error &&
          (error.message.includes('could not be removed because it is locked') ||
           error.message.includes('not found'))) {
        console.log(`Job removal skipped due to lock or not found: ${monitorId}`);
        return false;
      }

      throw error;
    }
  }

  private async removePendingJobsWithRetry(monitorId: string, schedulerId: string, maxRetries: number = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
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
            try {
              await job.remove();
              console.log(`Removed pending job for monitor: ${monitorId}`);
            } catch (jobError) {
              // Handle individual job removal errors
              if (jobError instanceof Error &&
                  jobError.message.includes('could not be removed because it is locked')) {
                console.log(`Job ${job.id} is locked, skipping removal (attempt ${attempt}/${maxRetries})`);

                if (attempt === maxRetries) {
                  console.log(`Final attempt: Job ${job.id} remains locked, but continuing`);
                } else {
                  // Wait before retry with exponential backoff
                  await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                  throw jobError; // Retry the entire operation
                }
              } else {
                throw jobError;
              }
            }
          }
        }

        // If we get here, all jobs were processed successfully
        break;

      } catch (error) {
        if (attempt === maxRetries) {
          console.log(`Failed to remove all pending jobs after ${maxRetries} attempts, but continuing`);
          break;
        }
        // Continue to next attempt
      }
    }
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
      console.error('Error getting job schedulers:', error);
      return [];
    }
  }
}
