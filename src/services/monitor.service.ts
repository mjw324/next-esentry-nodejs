import { prisma } from '../lib/prisma';
import { CreateMonitorDTO, MonitorResponse } from '../types/monitor.types';
import { RateLimitService } from './ratelimit.service';
import { MonitorQueue } from '../queues/monitor.queue';
import { CacheService } from './cache.service';
import { RateLimitError } from '../utils/errors';

export class MonitorService {
  constructor(
    private rateLimitService: RateLimitService,
    private monitorQueue: MonitorQueue,
    private cacheService: CacheService
  ) {}

  /**
   * Initialize job schedulers for all active monitors
   * This should be called on application startup
   */
  async initializeActiveMonitors() {
    try {
      console.log('Initializing job schedulers for active monitors...');

      // First, clean up any orphaned job schedulers from deleted monitors
      await this.cleanupOrphanedJobSchedulers();

      const activeMonitors = await prisma.monitor.findMany({
        where: { status: 'active' },
        select: { id: true, interval: true },
      });

      console.log(
        `Found ${activeMonitors.length} active monitors to initialize`
      );

      for (const monitor of activeMonitors) {
        try {
          await this.cacheService.clearResults(monitor.id);
          await this.monitorQueue.addMonitorJob(monitor.id, monitor.interval);
          console.log(
            `Initialized job scheduler for monitor: ${monitor.id} (interval: ${monitor.interval}ms)`
          );
        } catch (error) {
          console.error(
            `Failed to initialize job scheduler for monitor ${monitor.id}:`,
            error
          );
        }
      }

      console.log('Monitor initialization complete');
    } catch (error) {
      console.error('Error during monitor initialization:', error);
    }
  }

  /**
   * Clean up job schedulers for monitors that no longer exist in the database
   * This prevents orphaned schedulers from continuing to run jobs for deleted monitors
   */
  private async cleanupOrphanedJobSchedulers() {
    try {
      console.log('Cleaning up orphaned job schedulers...');

      // Get all existing job schedulers from the queue
      const schedulers = await this.monitorQueue.getJobSchedulers();

      if (schedulers.length === 0) {
        console.log('No job schedulers found to clean up');
        return;
      }

      console.log(`Found ${schedulers.length} job schedulers to check`);

      // Get all monitor IDs from the database
      const existingMonitors = await prisma.monitor.findMany({
        select: { id: true },
      });
      const existingMonitorIds = new Set(existingMonitors.map((m) => m.id));

      let cleanedCount = 0;

      for (const scheduler of schedulers) {
        // Extract monitor ID from scheduler name (format: "monitor:${monitorId}")
        if (scheduler.name && scheduler.name.startsWith('monitor:')) {
          const monitorId = scheduler.name.substring(8); // Remove "monitor:" prefix

          // If this monitor doesn't exist in the database, remove its scheduler
          if (!existingMonitorIds.has(monitorId)) {
            try {
              await this.monitorQueue.removeMonitorJob(monitorId);
              cleanedCount++;
              console.log(
                `Removed orphaned job scheduler for deleted monitor: ${monitorId}`
              );
            } catch (error) {
              console.error(
                `Failed to remove orphaned scheduler for monitor ${monitorId}:`,
                error
              );
            }
          }
        }
      }

      console.log(
        `Cleanup complete. Removed ${cleanedCount} orphaned job schedulers`
      );
    } catch (error) {
      console.error('Error during job scheduler cleanup:', error);
    }
  }

  /**
   * Create a new monitor for a user
   * @param userId The ID of the user creating the monitor
   * @param data The monitor data
   * @returns The created monitor
   */
  async createMonitor(userId: string, data: CreateMonitorDTO) {
    // Check if user exists with active alert email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        alertEmails: {
          where: { status: 'active' },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check if user has reached their monitor limit
    this.rateLimitService.validateUserMonitorLimit(userId);

    // Create the monitor
    const monitor = await prisma.monitor.create({
      data: {
        userId,
        keywords: data.keywords,
        excludedKeywords: data.excludedKeywords || [],
        minPrice: data.minPrice,
        maxPrice: data.maxPrice,
        conditions: data.conditions || [],
        sellers: data.sellers || [],
        interval: data.interval,
        status: 'inactive',
      },
    });

    // Transform the response to match the expected format
    return {
      id: monitor.id,
      userId: monitor.userId,
      keywords: monitor.keywords,
      excludedKeywords: monitor.excludedKeywords,
      minPrice: monitor.minPrice,
      maxPrice: monitor.maxPrice,
      conditions: monitor.conditions,
      sellers: monitor.sellers,
      status: monitor.status,
      interval: monitor.interval,
      nextCheckAt: monitor.nextCheckAt,
      lastCheckTime: monitor.lastCheckTime,
      lastResultCount: monitor.lastResultCount,
    };
  }

  /**
   * Get all monitors for a user
   * @param userId The ID of the user
   * @returns Array of monitors and a boolean indicating if the user has an active email
   */
  async getUserMonitors(userId: string) {
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get all monitors for the user
    const monitors = await prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Check if the user has at least one active alert email
    let activeEmail = await prisma.alertEmail.findFirst({
      where: {
        userId,
        status: 'active',
      },
    });

    // If no active alert email but user email is verified, create one automatically
    if (!activeEmail && user.emailVerified && user.email) {
      activeEmail = await prisma.alertEmail.create({
        data: {
          userId,
          email: user.email,
          status: 'active',
        },
      });
    }

    const hasActiveEmail = !!activeEmail;

    // Return both monitors and hasActiveEmail flag
    return {
      monitors: monitors.map(
        (monitor: any): MonitorResponse => ({
          id: monitor.id,
          userId: monitor.userId,
          keywords: monitor.keywords,
          excludedKeywords: monitor.excludedKeywords,
          minPrice: monitor.minPrice ?? undefined,
          maxPrice: monitor.maxPrice ?? undefined,
          conditions: monitor.conditions,
          sellers: monitor.sellers,
          status: monitor.status,
          interval: monitor.interval,
          nextCheckAt: monitor.nextCheckAt ?? undefined,
          lastCheckTime: monitor.lastCheckTime ?? undefined,
          lastResultCount: monitor.lastResultCount,
        })
      ),
      hasActiveEmail,
    };
  }

  /**
   * Toggle a monitor's active status
   * @param monitorId The ID of the monitor to update
   * @param active Whether to activate or deactivate the monitor
   * @returns The updated monitor
   */
  async toggleMonitorStatus(monitorId: string, active: boolean) {
    console.log(
      `Toggling monitor ${monitorId} to ${active ? 'active' : 'inactive'}`
    );
    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: { user: true },
    });

    if (!monitor) {
      throw new Error('Monitor not found');
    }

    // Check toggle rate limit to prevent rapid switching - we allow toggling off without limit
    const canToggle =
      !active ||
      (await this.rateLimitService.checkMonitorToggleLimit(monitor.userId));
    if (!canToggle) {
      throw new RateLimitError(
        'Too many monitor status changes. Please wait a moment before toggling again.'
      );
    }

    // If activating and already active, or deactivating and already inactive, do nothing
    if (
      (active && monitor.status === 'active') ||
      (!active && monitor.status === 'inactive')
    ) {
      return {
        id: monitor.id,
        userId: monitor.userId,
        keywords: monitor.keywords,
        excludedKeywords: monitor.excludedKeywords,
        minPrice: monitor.minPrice,
        maxPrice: monitor.maxPrice,
        conditions: monitor.conditions,
        sellers: monitor.sellers,
        status: monitor.status,
        interval: monitor.interval,
        nextCheckAt: monitor.nextCheckAt,
        lastCheckTime: monitor.lastCheckTime,
        lastResultCount: monitor.lastResultCount,
      };
    }

    // If activating, check active monitor limit
    if (active) {
      // Check if user has reached their active monitor limit
      const activeMonitorsCount = await prisma.monitor.count({
        where: {
          userId: monitor.userId,
          status: 'active',
        },
      });

      if (activeMonitorsCount >= monitor.user.maxActiveMonitors) {
        throw new RateLimitError(
          `You have reached the maximum limit of ${monitor.user.maxActiveMonitors} active monitors. Please deactivate or delete an existing monitor before activating this one.`
        );
      }
    }

    // If deactivating, make sure we remove all jobs and clear cache first
    if (!active) {
      console.log('removing monitor job and clearing cache');
      await this.monitorQueue.removeMonitorJob(monitorId);
      await this.cacheService.clearResults(monitorId);
    }

    // Update monitor status
    const updatedMonitor = await prisma.monitor.update({
      where: { id: monitorId },
      data: {
        status: active ? 'active' : 'inactive',
        nextCheckAt: active ? new Date() : null, // Schedule immediate check if activating
      },
    });

    // If activating, add the job scheduler after the monitor is updated
    if (active) {
      await this.monitorQueue.addMonitorJob(monitorId, updatedMonitor.interval);
    }

    // Return the updated monitor
    return {
      id: updatedMonitor.id,
      userId: updatedMonitor.userId,
      keywords: updatedMonitor.keywords,
      excludedKeywords: updatedMonitor.excludedKeywords,
      minPrice: updatedMonitor.minPrice,
      maxPrice: updatedMonitor.maxPrice,
      conditions: updatedMonitor.conditions,
      sellers: updatedMonitor.sellers,
      status: updatedMonitor.status,
      interval: updatedMonitor.interval,
      nextCheckAt: updatedMonitor.nextCheckAt,
      lastCheckTime: updatedMonitor.lastCheckTime,
      lastResultCount: updatedMonitor.lastResultCount,
    };
  }

  /**
   * Update a monitor
   * @param monitorId The ID of the monitor to update
   * @param userId The ID of the user who owns the monitor
   * @param updates The updates to apply
   * @returns The updated monitor
   */
  async updateMonitor(
    monitorId: string,
    userId: string,
    updates: Partial<CreateMonitorDTO> & { status?: 'active' | 'inactive' }
  ) {
    // Verify the monitor exists and belongs to the user
    const monitor = await prisma.monitor.findFirst({
      where: {
        id: monitorId,
        userId,
      },
      include: { user: true },
    });

    if (!monitor) {
      throw new Error('Monitor not found');
    }

    // Check toggle rate limit if status is being changed
    if (updates.status !== undefined && updates.status !== monitor.status) {
      const canToggle =
        await this.rateLimitService.checkMonitorToggleLimit(userId);
      if (!canToggle) {
        throw new RateLimitError(
          'Too many monitor status changes. Please wait a moment before toggling again.'
        );
      }
    }

    // If status is changing to active, check active monitor limit
    if (updates.status === 'active' && monitor.status !== 'active') {
      const activeMonitorsCount = await prisma.monitor.count({
        where: {
          userId,
          status: 'active',
        },
      });

      if (activeMonitorsCount >= monitor.user.maxActiveMonitors) {
        throw new RateLimitError(
          `You have reached the maximum limit of ${monitor.user.maxActiveMonitors} active monitors. Please deactivate or delete an existing monitor before activating this one.`
        );
      }
    }

    // Prepare update data
    const updateData: any = {};

    if (updates.keywords !== undefined) updateData.keywords = updates.keywords;
    if (updates.excludedKeywords !== undefined)
      updateData.excludedKeywords = updates.excludedKeywords;
    if (updates.minPrice !== undefined) updateData.minPrice = updates.minPrice;
    if (updates.maxPrice !== undefined) updateData.maxPrice = updates.maxPrice;
    if (updates.conditions !== undefined)
      updateData.conditions = updates.conditions;
    if (updates.sellers !== undefined) updateData.sellers = updates.sellers;
    if (updates.interval !== undefined) {
      updateData.interval = updates.interval;
      // If monitor is active and interval is being changed, update the job scheduler
      if (monitor.status === 'active') {
        await this.monitorQueue.removeMonitorJob(monitorId);
        await this.monitorQueue.addMonitorJob(monitorId, updates.interval);
      }
    }
    if (updates.status !== undefined) {
      updateData.status = updates.status;

      if (updates.status === 'active') {
        updateData.nextCheckAt = new Date();
        await this.monitorQueue.removeMonitorJob(monitorId);
        // Get the updated monitor to access the interval
        const currentMonitor = await prisma.monitor.findUnique({
          where: { id: monitorId },
        });
        await this.monitorQueue.addMonitorJob(
          monitorId,
          currentMonitor?.interval || updates.interval
        );
      } else {
        await this.monitorQueue.removeMonitorJob(monitorId);
        await this.cacheService.clearResults(monitorId);
      }
    }

    // Update the monitor
    const updatedMonitor = await prisma.monitor.update({
      where: { id: monitorId },
      data: updateData,
    });

    // Return the updated monitor
    return {
      id: updatedMonitor.id,
      userId: updatedMonitor.userId,
      keywords: updatedMonitor.keywords,
      excludedKeywords: updatedMonitor.excludedKeywords,
      minPrice: updatedMonitor.minPrice,
      maxPrice: updatedMonitor.maxPrice,
      conditions: updatedMonitor.conditions,
      sellers: updatedMonitor.sellers,
      status: updatedMonitor.status,
      interval: updatedMonitor.interval,
      nextCheckAt: updatedMonitor.nextCheckAt,
      lastCheckTime: updatedMonitor.lastCheckTime,
      lastResultCount: updatedMonitor.lastResultCount,
    };
  }
  /**
   * Delete a monitor
   * @param monitorId The ID of the monitor to delete
   * @param userId The ID of the user who owns the monitor
   */
  async deleteMonitor(monitorId: string, userId: string) {
    // Verify the monitor exists and belongs to the user
    const monitor = await prisma.monitor.findFirst({
      where: {
        id: monitorId,
        userId,
      },
    });

    if (!monitor) {
      throw new Error('Monitor not found');
    }

    await this.monitorQueue.removeMonitorJob(monitorId);
    await this.cacheService.clearResults(monitorId);

    // Delete the monitor
    await prisma.monitor.delete({
      where: { id: monitorId },
    });
  }

  /**
   * Unsubscribe from monitor notifications via email link
   * @param monitorId The ID of the monitor to deactivate
   * @param email The email address of the user unsubscribing
   * @returns Success message or throws error
   */
  async unsubscribeFromMonitor(
    monitorId: string,
    email: string
  ): Promise<{ success: boolean; message: string }> {
    // Find the monitor and verify it exists
    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: {
        user: {
          include: {
            alertEmails: {
              where: {
                email: email,
                status: 'active',
              },
            },
          },
        },
      },
    });

    if (!monitor) {
      return { success: false, message: 'Monitor not found' };
    }

    // Check if the email is associated with the user who owns this monitor
    const hasMatchingEmail = monitor.user.alertEmails.some(
      (alertEmail) =>
        alertEmail.email === email && alertEmail.status === 'active'
    );

    if (!hasMatchingEmail) {
      return {
        success: false,
        message: 'Email not authorized for this monitor',
      };
    }

    // Only deactivate if the monitor is currently active
    if (monitor.status === 'inactive') {
      return { success: true, message: 'Monitor was already inactive' };
    }

    // Deactivate the monitor
    await this.monitorQueue.removeMonitorJob(monitorId);
    await this.cacheService.clearResults(monitorId);

    await prisma.monitor.update({
      where: { id: monitorId },
      data: {
        status: 'inactive',
        nextCheckAt: null,
      },
    });

    return {
      success: true,
      message: 'Successfully unsubscribed from monitor notifications',
    };
  }
}
