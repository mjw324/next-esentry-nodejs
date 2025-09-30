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

  async createMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user.id;
  
      // Check if user has an active alert email
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          alertEmails: {
            where: { status: 'active' }
          }
        }
      });
  
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
  
      // If no active alert email but user email is verified, create one automatically
      if (user.alertEmails.length === 0 && user.emailVerified && user.email) {
        await prisma.alertEmail.create({
          data: {
            userId,
            email: user.email,
            status: 'active'
          }
        });
      }

      // Check if user has an active alert email OR a verified account email
      if (user.alertEmails.length === 0 && !user.emailVerified) {
        res.status(400).json({
          error: 'No active email found',
          message: 'You need to verify your email or set up an active alert email before creating a monitor',
        });
        return;
      }
  
      // Create the monitor
      const monitor = await this.monitorService.createMonitor(userId, req.body);
  
      res.status(201).json({
        monitor,
        emailStatus: 'ready'
      });
    } catch (error) {
      next(error);
    }
  }
  
  async getUserMonitors(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.id;
  
      // Get all monitors for the user and check if they have an active email
      const result = await this.monitorService.getUserMonitors(userId);
  
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async toggleMonitorStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { active } = req.body;
  
      if (typeof active !== 'boolean') {
        res.status(400).json({ error: 'Active status must be a boolean' });
        return; // Just return without the response object
      }
      console.log(`"Im getting here ${id} ${active}`)
      const userId = req.user.id;
  
      // Verify the monitor belongs to the user
      const monitor = await prisma.monitor.findFirst({
        where: { 
          id,
          userId
        }
      });
      console.log(`"Im getting here ${id} ${active}`)
      if (!monitor) {
        res.status(404).json({ error: 'Monitor not found' });
        return; // Just return without the response object
      }
      console.log(`"Im getting here ${id} ${active}`)
      // Toggle the monitor status
      const updatedMonitor = await this.monitorService.toggleMonitorStatus(id, active);
  
      res.status(200).json(updatedMonitor);
      // No return statement here is correct
    } catch (error) {
      next(error);
    }
  }
  
  
  async updateMonitor(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
  
      // Update the monitor
      const updatedMonitor = await this.monitorService.updateMonitor(id, userId, req.body);
  
      res.status(200).json(updatedMonitor);
    } catch (error) {
      next(error);
    }
  }

  async deleteMonitor(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
  
      // Delete the monitor
      const deletedMonitor = await this.monitorService.deleteMonitor(id, userId);
  
      res.status(200).json(deletedMonitor);
    } catch (error) {
      next(error);
    }
  }
}