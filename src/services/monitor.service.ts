import { prisma } from '../lib/prisma';
import { CreateMonitorDTO } from '../types/monitor.types';
import { RateLimitService } from './ratelimit.service';
import { MonitorQueue } from '../queues/monitor.queue';
import { Monitor } from '@prisma/client';

export class MonitorService {
  constructor(
    private rateLimitService: RateLimitService,
    private monitorQueue: MonitorQueue
  ) {}

  /**
   * Initialize job schedulers for all active monitors
   * This should be called on application startup
   */
  async initializeActiveMonitors() {
    try {
      console.log('Initializing job schedulers for active monitors...');

      const activeMonitors = await prisma.monitor.findMany({
        where: { status: 'active' },
        select: { id: true, interval: true }
      });

      console.log(`Found ${activeMonitors.length} active monitors to initialize`);

      for (const monitor of activeMonitors) {
        try {
          await this.monitorQueue.addMonitorJob(monitor.id, monitor.interval);
          console.log(`Initialized job scheduler for monitor: ${monitor.id} (interval: ${monitor.interval}ms)`);
        } catch (error) {
          console.error(`Failed to initialize job scheduler for monitor ${monitor.id}:`, error);
        }
      }

      console.log('Monitor initialization complete');
    } catch (error) {
      console.error('Error during monitor initialization:', error);
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
          where: { status: 'active' }
        }
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
        status: 'active'
      }
    });

    // If no active alert email but user email is verified, create one automatically
    if (!activeEmail && user.emailVerified && user.email) {
      activeEmail = await prisma.alertEmail.create({
        data: {
          userId,
          email: user.email,
          status: 'active'
        }
      });
    }

    const hasActiveEmail = !!activeEmail;

    // Return both monitors and hasActiveEmail flag
    return {
      monitors: monitors.map((monitor: Monitor) => ({
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
      })),
      hasActiveEmail
    };
  }

  /**
   * Toggle a monitor's active status
   * @param monitorId The ID of the monitor to update
   * @param active Whether to activate or deactivate the monitor
   * @returns The updated monitor
   */
  async toggleMonitorStatus(monitorId: string, active: boolean) {
    console.log(`Toggling monitor ${monitorId} to ${active ? 'active' : 'inactive'}`);
    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: { user: true },
    });

    if (!monitor) {
      throw new Error('Monitor not found');
    }

    // If activating and already active, or deactivating and already inactive, do nothing
    if ((active && monitor.status === 'active') || (!active && monitor.status === 'inactive')) {
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
        throw new Error('Maximum number of active monitors reached');
      }
    }

    // If deactivating, make sure we remove all jobs first
    if (!active) {
      console.log("removing monitor job")
      await this.monitorQueue.removeMonitorJob(monitorId);
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
  async updateMonitor(monitorId: string, userId: string, updates: Partial<CreateMonitorDTO> & { status?: 'active' | 'inactive' }) {
    // Verify the monitor exists and belongs to the user
    const monitor = await prisma.monitor.findFirst({
      where: { 
        id: monitorId,
        userId
      },
      include: { user: true },
    });

    if (!monitor) {
      throw new Error('Monitor not found');
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
        throw new Error('Maximum number of active monitors reached');
      }
    }

    // Prepare update data
    const updateData: any = {};

    if (updates.keywords !== undefined) updateData.keywords = updates.keywords;
    if (updates.excludedKeywords !== undefined) updateData.excludedKeywords = updates.excludedKeywords;
    if (updates.minPrice !== undefined) updateData.minPrice = updates.minPrice;
    if (updates.maxPrice !== undefined) updateData.maxPrice = updates.maxPrice;
    if (updates.conditions !== undefined) updateData.conditions = updates.conditions;
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
        const currentMonitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
        await this.monitorQueue.addMonitorJob(monitorId, currentMonitor?.interval || updates.interval);
      } else {
        await this.monitorQueue.removeMonitorJob(monitorId);
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
        userId
      }
    });

    if (!monitor) {
      throw new Error('Monitor not found');
    }
    
    await this.monitorQueue.removeMonitorJob(monitorId);

    // Delete the monitor
    await prisma.monitor.delete({
      where: { id: monitorId }
    });
  }
}
