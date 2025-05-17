// src/controllers/email.controller.ts
import { Request, Response, NextFunction } from 'express';
import { EmailService } from '../services/email.service';
import { VerificationService } from '../services/verification.service';
import { prisma } from '../lib/prisma';

export class EmailController {
  constructor(
    private emailService: EmailService,
    private verificationService: VerificationService
  ) { }

  setupEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body;
      const userId = req.user.id;

      const { token, pin } = await this.verificationService.createEmailVerification(
        userId,
        email
      );

      await this.emailService.sendVerificationEmail(email, token, pin);

      res.status(200).json({
        message: 'Verification email sent',
      });
    } catch (error) {
      next(error);
    }
  };

  verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tokenOrPin } = req.body;
      const userId = req.user.id;

      const result = await this.verificationService.verifyEmail(userId, tokenOrPin);

      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      res.status(200).json({ message: result.message });
    } catch (error) {
      next(error);
    }
  };

  getUserEmails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user.id;

      const alertEmails = await prisma.alertEmail.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.status(200).json(alertEmails);
    } catch (error) {
      next(error);
    }
  };

  addAlertEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body;
      const userId = req.user.id;

      // Check if email already exists for this user
      const existingEmail = await prisma.alertEmail.findFirst({
        where: {
          userId
        }
      });

      if (existingEmail) {
        res.status(400).json({ error: 'This email is already registered with your account' });
        return;
      }

      // Create verification for the new email
      const { token, pin } = await this.verificationService.createEmailVerification(
        userId,
        email
      );

      // Send verification email
      await this.emailService.sendVerificationEmail(email, token, pin);

      // Get the newly created email record
      const newEmail = await prisma.alertEmail.findFirst({
        where: {
          userId,
          email
        },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.status(201).json({
        message: 'Verification email sent',
        email: newEmail
      });
    } catch (error) {
      next(error);
    }
  };

  setEmailActive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user.id;
      const { emailId } = req.params;

      // Check if email exists and belongs to user
      const emailToActivate = await prisma.alertEmail.findFirst({
        where: {
          id: emailId,
          userId
        }
      });

      if (!emailToActivate) {
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      // Check if email is in "ready" status
      if (emailToActivate.status !== 'ready') {
        res.status(400).json({ 
          error: 'Only verified emails in "ready" status can be set as active'
        });
        return;
      }

      // Start a transaction
      await prisma.$transaction(async (tx: { alertEmail: { findFirst: (arg0: { where: { userId: string; status: string; }; }) => any; update: (arg0: { where: { id: any; } | { id: string; }; data: { status: string; updatedAt: Date; } | { status: string; updatedAt: Date; }; }) => any; }; user: { update: (arg0: { where: { id: string; }; data: { updatedAt: Date; }; }) => any; }; }) => {
        // Find current active email if any
        const activeEmail = await tx.alertEmail.findFirst({
          where: {
            userId,
            status: 'active'
          }
        });

        // If there's an active email, change it to 'ready'
        if (activeEmail) {
          await tx.alertEmail.update({
            where: { id: activeEmail.id },
            data: { 
              status: 'ready',
              updatedAt: new Date()
            }
          });
        }

        // Set the requested email as active
        await tx.alertEmail.update({
          where: { id: emailId },
          data: {
            status: 'active',
            updatedAt: new Date()
          }
        });

        // Update the user's lastEmailChangeDate
        await tx.user.update({
          where: { id: userId },
          data: { 
            updatedAt: new Date() 
          }
        });
      });

      // Get all user's emails with updated statuses
      const updatedEmails = await prisma.alertEmail.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.status(200).json({
        message: 'Alert email activated successfully',
        emails: updatedEmails
      });
    } catch (error) {
      next(error);
    }
  };

  deleteAlertEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user.id;
      const { emailId } = req.params;

      // Check if email exists and belongs to user
      const emailToDelete = await prisma.alertEmail.findFirst({
        where: {
          id: emailId,
          userId
        }
      });

      if (!emailToDelete) {
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      // Cannot delete active email
      if (emailToDelete.status === 'active') {
        res.status(400).json({ 
          error: 'Cannot delete the active email. Set another email as active first.'
        });
        return;
      }

      // Delete the email
      await prisma.alertEmail.delete({
        where: { id: emailId }
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  verifyEmailById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user.id;
      const { emailId } = req.params;
      const { otp } = req.body;

      const result = await this.verificationService.verifyEmailById(userId, emailId, otp);

      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      res.status(200).json({ 
        message: result.message,
        email: result.email
      });
    } catch (error) {
      next(error);
    }
  };

  resendVerificationCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user.id;
      const { emailId } = req.params;

      const result = await this.verificationService.resendVerificationCode(userId, emailId);

      if (!result.success) {
        const status = result.message.includes('Please wait') ? 429 : 400;
        res.status(status).json({ error: result.message });
        return;
      }

      // Send the new verification email
      const email = await prisma.alertEmail.findUnique({
        where: { id: emailId }
      });

      if (email && result.token && result.pin) {
        await this.emailService.sendVerificationEmail(
          email.email,
          result.token,
          result.pin
        );
      }

      res.status(200).json({ message: 'Verification code resent' });
    } catch (error) {
      next(error);
    }
  };

  getEmailStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user.id;
      const { emailId } = req.params;

      const email = await prisma.alertEmail.findFirst({
        where: { 
          id: emailId,
          userId
        },
        select: {
          id: true,
          email: true,
          status: true,
          verificationExpires: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!email) {
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      // Calculate expiration if in pending verification state
      let expiresIn = null;
      if (email.status === 'pending verification' && email.verificationExpires) {
        const now = new Date();
        const expires = new Date(email.verificationExpires);
        if (expires > now) {
          expiresIn = Math.floor((expires.getTime() - now.getTime()) / 1000); // seconds
        } else {
          expiresIn = 0; // Already expired
        }
      }

      res.status(200).json({
        id: email.id,
        email: email.email,
        status: email.status,
        expiresIn,
        createdAt: email.createdAt,
        updatedAt: email.updatedAt
      });
    } catch (error) {
      next(error);
    }
  };

  verifyToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body;
  
      if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }
      const result = await this.verificationService.verifyEmailWithToken(token);

      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      res.status(200).json({ 
        message: result.message,
        email: result.email
      });
    } catch (error) {
      next(error);
    }
  };
}
