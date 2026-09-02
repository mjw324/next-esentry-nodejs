// src/services/notification.service.ts
import { prisma } from '../lib/prisma';
import { EmailSettings, NotificationPayload } from '../types/notification.types';
import { RateLimitService } from './ratelimit.service';
import { EmailService } from './email.service';
import { EbayItem } from '../types/ebay.types';
import { logger } from '../utils/logger';

export class NotificationService {
  constructor(
    private rateLimitService: RateLimitService,
    private emailService: EmailService
  ) {}

  async getUserEmailSettings(userId: string): Promise<EmailSettings> {
    // Get the active email for the user
    const activeEmail = await prisma.alertEmail.findFirst({
      where: { 
        userId,
        status: 'active'
      }
    });

    return {
      userId,
      activeEmail: activeEmail ? {
        id: activeEmail.id,
        email: activeEmail.email,
        status: activeEmail.status
      } : null
    };
  }

  async sendNotification(payload: NotificationPayload): Promise<void> {
    // Check rate limits
    const canSend = await this.rateLimitService.checkNotificationLimit(
      payload.userId,
      payload.type
    );

    if (!canSend) {
      logger.warn('notification.rate_limited', {
        userId: payload.userId,
        monitorId: payload.monitorId,
      });
      return;
    }

    // Get user and monitor details
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      logger.warn('notification.user_missing', { userId: payload.userId });
      return;
    }

    // Get email settings
    const emailSettings = await this.ensureEmailSettings(payload.userId, user.email);

    const monitor = await prisma.monitor.findUnique({
      where: { id: payload.monitorId }
    });

    if (!monitor) {
      logger.warn('notification.monitor_missing', { monitorId: payload.monitorId });
      return;
    }

    try {
      // Send email notification for new monitor results
      if (payload.type === 'MONITOR_RESULTS' && emailSettings.activeEmail) {
        const emailAddress = emailSettings.activeEmail.email;

        // Get the monitor keywords to use as a title
        const monitorTitle = monitor.keywords.join(' ');

        // Send email with new items
        await this.emailService.sendNewItemsNotification(
          emailAddress,
          monitorTitle,
          payload.data.newItems as EbayItem[],
          payload.monitorId
        );

        // Count the notification against this monitor only. This used to be an
        // updateMany across every monitor the user owned, inside the rate-limit
        // check -- which is why production shows near-identical counts (992,
        // 992, 992, 1100, ...) on monitors that ran at different times.
        await prisma.monitor.update({
          where: { id: monitor.id },
          data: { notificationCount: { increment: 1 } },
        });

        logger.info('notification.sent', {
          monitorId: monitor.id,
          items: (payload.data.newItems as EbayItem[])?.length ?? 0,
        });
      } else if (payload.type === 'MONITOR_RESULTS') {
        logger.warn('notification.no_active_email', { userId: payload.userId });
      }
    } catch (error) {
      logger.error('notification.send_failed', {
        monitorId: payload.monitorId,
        error,
      });
    }
  }  

  async ensureEmailSettings(userId: string, userEmail: string): Promise<EmailSettings> {
    let settings = await this.getUserEmailSettings(userId);

    // If no active email exists, create one using the user's login email
    if (!settings.activeEmail) {
      await prisma.alertEmail.create({
        data: {
          userId,
          email: userEmail,
          status: 'active'
        }
      });

      // Fetch the newly created settings
      settings = await this.getUserEmailSettings(userId);

      if (!settings.activeEmail) {
        throw new Error('Failed to create alert email');
      }
    }

    return settings;
  }
}
