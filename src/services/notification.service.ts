// src/services/notification.service.ts
import { prisma } from '../lib/prisma';
import { NotificationSettings, NotificationPayload } from '../types/notification.types';
import { RateLimitService } from './ratelimit.service';

export class NotificationService {
  constructor(
    private rateLimitService: RateLimitService
  ) { }

  async getUserNotificationSettings(userId: string): Promise<NotificationSettings | null> {
    const settings = await prisma.notificationSettings.findUnique({
      where: { userId }
    });

    if (!settings) return null;

    return {
      userId: settings.userId,
      channels: {
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
