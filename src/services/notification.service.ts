// src/services/notification.service.ts
import { prisma } from '../lib/prisma';
import { EmailSettings, NotificationPayload } from '../types/notification.types';
import { RateLimitService } from './ratelimit.service';
import { EmailService } from './email.service';
import { EbayItem } from '../types/ebay.types';

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
    console.log('Sending notification:', payload);

    // Check rate limits
    const canSend = await this.rateLimitService.checkNotificationLimit(
      payload.userId,
      payload.type
    );

    if (!canSend) {
      console.log(`Rate limit exceeded for user ${payload.userId}`);
      return;
    }

    // Get user and monitor details
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      console.log(`User not found: ${payload.userId}`);
      return;
    }

    // Get email settings
    const emailSettings = await this.ensureEmailSettings(payload.userId, user.email);

    const monitor = await prisma.monitor.findUnique({
      where: { id: payload.monitorId }
    });

    if (!monitor) {
      console.log(`Monitor not found: ${payload.monitorId}`);
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

        console.log(`Email notification sent to ${emailAddress} for monitor ${monitor.id}`);
      } else if (payload.type === 'MONITOR_RESULTS') {
        console.log(`No active email found for user ${payload.userId}`);
      }
    } catch (error) {
      console.error('Error sending notification:', error);
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
