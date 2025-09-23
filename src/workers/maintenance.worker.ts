import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../lib/prisma';
import { MonitorQueue } from '../queues/monitor.queue';
import { CacheService } from '../services/cache.service';
import { bullMQRedisConnection } from '../config/redis.config';

export class MaintenanceWorker {
  private worker: Worker;

  constructor(
    redis: Redis,
    private monitorQueue: MonitorQueue,
    private cacheService: CacheService
  ) {
    this.worker = new Worker(
      'maintenance-queue',
      this.processJob.bind(this),
      {
        connection: bullMQRedisConnection,
        concurrency: 1
      }
    );

    this.worker.on('error', err => {
      console.error('Maintenance worker error:', err);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Maintenance job ${job?.id} failed:`, err);
    });
  }

  private async processJob(job: Job): Promise<void> {
    const { type } = job.data;

    switch (type) {
      case 'disable-inactive-monitors':
        await this.disableInactiveUserMonitors();
        break;
      case 'cleanup-orphaned-jobs':
        await this.cleanupOrphanedCronJobs();
        break;
      default:
        console.warn(`Unknown maintenance job type: ${type}`);
    }
  }

  private async disableInactiveUserMonitors(): Promise<void> {
    try {
      console.log('Starting inactive user monitor cleanup...');

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const inactiveUsers = await prisma.user.findMany({
        where: {
          lastLoggedIn: {
            lt: threeDaysAgo
          }
        },
        include: {
          monitors: {
            where: {
              status: 'active'
            }
          }
        }
      });

      console.log(`Found ${inactiveUsers.length} users inactive for 3+ days with active monitors`);

      let totalMonitorsDisabled = 0;

      for (const user of inactiveUsers) {
        console.log(`Processing user ${user.id} with ${user.monitors.length} active monitors`);

        for (const monitor of user.monitors) {
          try {
            await prisma.monitor.update({
              where: { id: monitor.id },
              data: { status: 'inactive' }
            });

            await this.monitorQueue.removeMonitorJob(monitor.id);
            await this.cacheService.clearResults(monitor.id);

            totalMonitorsDisabled++;
            console.log(`Disabled monitor ${monitor.id} for inactive user ${user.id}`);
          } catch (error) {
            console.error(`Error disabling monitor ${monitor.id} for user ${user.id}:`, error);
          }
        }
      }

      console.log(`Inactive user cleanup completed. Disabled ${totalMonitorsDisabled} monitors.`);
    } catch (error) {
      console.error('Error during inactive user monitor cleanup:', error);
      throw error;
    }
  }

  private async cleanupOrphanedCronJobs(): Promise<void> {
    try {
      console.log('Starting orphaned cron job cleanup...');

      const activeMonitors = await prisma.monitor.findMany({
        where: {
          status: 'active'
        },
        select: {
          id: true
        }
      });

      const activeMonitorIds = new Set(activeMonitors.map((m: { id: string }) => m.id));
      console.log(`Found ${activeMonitorIds.size} active monitors in database`);

      const queue = this.monitorQueue['queue'];
      const schedulers = await queue.getJobSchedulers(0, -1, true);
      console.log(`Found ${schedulers.length} job schedulers in queue`);

      let orphanedJobsRemoved = 0;

      for (const scheduler of schedulers) {
        if (scheduler.id && scheduler.id.startsWith('monitor:')) {
          const monitorId = scheduler.id.replace('monitor:', '');

          if (!activeMonitorIds.has(monitorId)) {
            try {
              await queue.removeJobScheduler(scheduler.id);
              await this.cacheService.clearResults(monitorId);
              orphanedJobsRemoved++;
              console.log(`Removed orphaned job scheduler for monitor: ${monitorId}`);
            } catch (error) {
              console.error(`Error removing orphaned job scheduler ${scheduler.id}:`, error);
            }
          }
        }
      }

      console.log(`Orphaned cron job cleanup completed. Removed ${orphanedJobsRemoved} orphaned jobs.`);
    } catch (error) {
      console.error('Error during orphaned cron job cleanup:', error);
      throw error;
    }
  }
}