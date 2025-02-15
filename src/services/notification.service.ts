// src/services/notification.service.ts
import { PrismaClient } from '@prisma/client';
import { NotificationSettings, NotificationPayload } from '../types/notification.types';
import { RateLimitService } from './ratelimit.service';

export class NotificationService {
  constructor(
    private prisma: PrismaClient,
    private rateLimitService: RateLimitService
  ) { }

  async getUserNotificationSettings(userId: string): Promise<NotificationSettings | null> {
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { userId }
    });

    if (!settings) return null;

    return {
      userId: settings.userId,
      channels: {
        email: settings.emailEnabled ? {
          enabled: true,
          address: settings.emailAddress!
        } : undefined
      }
    };
  }

  async sendNotification(payload: NotificationPayload): Promise<void> {
    console.log('Sending notification:', payload);

    // Check rate limits
    // Create notification history entry

    // Implementation for actually sending notifications would go here
    // This could involve calling external services or queuing jobs
  }
}
