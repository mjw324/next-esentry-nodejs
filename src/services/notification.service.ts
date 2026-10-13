// src/services/notification.service.ts
import { prisma } from '../lib/prisma';
import { EmailSettings, NotificationPayload } from '../types/notification.types';
import { RateLimitService } from './ratelimit.service';
import { EmailService } from './email.service';
import { NotifiableItem } from '../types/ebay.types';
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
    // Check rate limits (1 Redis round trip; user limits are cached)
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

    if (payload.type !== 'MONITOR_RESULTS') {
      return;
    }

    // One query for the user, their active alert email, and the monitor title.
    // The caller (the worker) already holds the monitor row, so `monitorTitle`
    // is passed in rather than re-read.
    const recipient = await this.resolveRecipient(payload.userId);

    if (!recipient) {
      logger.warn('notification.no_active_email', { userId: payload.userId });
      return;
    }

    try {
      await this.emailService.sendNewItemsNotification(
        recipient,
        payload.monitorTitle,
        payload.data.newItems as NotifiableItem[],
        payload.monitorId
      );

      // Count the notification against this monitor only. This used to be an
      // updateMany across every monitor the user owned, inside the rate-limit
      // check -- which is why production shows near-identical counts (992,
      // 992, 992, 1100, ...) on monitors that ran at different times.
      await prisma.monitor.update({
        where: { id: payload.monitorId },
        data: { notificationCount: { increment: 1 } },
      });

      logger.info('notification.sent', {
        monitorId: payload.monitorId,
        items: (payload.data.newItems as NotifiableItem[])?.length ?? 0,
      });
    } catch (error) {
      logger.error('notification.send_failed', {
        monitorId: payload.monitorId,
        error,
      });
    }
  }

  /**
   * Resolve the address to notify: the user's active alert email, falling back
   * to creating one from their login email.
   *
   * One query instead of the previous three (user lookup, a second user lookup
   * inside sendNotification, and a separate alertEmail lookup).
   */
  private async resolveRecipient(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        alertEmails: {
          where: { status: 'active' },
          select: { email: true },
          take: 1,
        },
      },
    });

    if (!user) {
      logger.warn('notification.user_missing', { userId });
      return null;
    }

    if (user.alertEmails.length > 0) {
      return user.alertEmails[0].email;
    }

    if (!user.email) {
      return null;
    }

    // No active alert email yet: adopt the verified login address. upsert keeps
    // this safe against the AlertEmail (userId, email) unique constraint when
    // two jobs for the same user race here.
    const created = await prisma.alertEmail.upsert({
      where: { userId_email: { userId, email: user.email } },
      update: { status: 'active' },
      create: { userId, email: user.email, status: 'active' },
      select: { email: true },
    });

    return created.email;
  }

  async ensureEmailSettings(userId: string, userEmail: string): Promise<EmailSettings> {
    let settings = await this.getUserEmailSettings(userId);

    // If no active email exists, create one using the user's login email
    if (!settings.activeEmail) {
      await prisma.alertEmail.upsert({
        where: { userId_email: { userId, email: userEmail } },
        update: { status: 'active' },
        create: {
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
