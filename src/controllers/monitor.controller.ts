import { Request, Response, NextFunction } from 'express';
import { MonitorService } from '../services/monitor.service';
import { EmailService } from '../services/email.service';
import { VerificationService } from '../services/verification.service';
import { prisma } from '../lib/prisma';

export class MonitorController {
  constructor(
    private monitorService: MonitorService,
    private emailService: EmailService,
    private verificationService: VerificationService,
  ) {}

  async createMonitor(req: Request, res: Response, next: NextFunction) {
    try {
      const { useLoginEmail, customEmail } = req.body;
      const userId = req.user.id;

      const user = await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          loginEmail: customEmail || 'temp@email.com', // Temporary email if using custom
          loginProvider: 'EMAIL', // Or appropriate provider
        },
      });
      

      // Check if user has notification settings
      const existingSettings = await prisma.notificationSettings.findUnique({
        where: { userId }
      });

      // Handle email settings
      if (!existingSettings) {
        if (useLoginEmail) {
          // Email will be set automatically in MonitorService
        } else if (customEmail) {
          // Create verification for custom email
          const { token, pin } = await this.verificationService.createEmailVerification(
            userId,
            customEmail
          );
          await this.emailService.sendVerificationEmail(customEmail, token, pin);
        } else {
          throw new Error('Either useLoginEmail or customEmail must be provided');
        }
      }

      // Create the monitor
      const monitor = await this.monitorService.createMonitor(
        userId,
        req.body
      );

      res.status(201).json({
        monitor,
        emailStatus: !existingSettings && customEmail ? 'verification_required' : 'ready'
      });
    } catch (error) {
      next(error);
    }
  }
}