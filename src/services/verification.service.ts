import { prisma } from '../lib/prisma';
import { randomBytes } from 'crypto';
import { emailConfig } from '../config/email.config';

export class VerificationService {
  constructor() { }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async createEmailVerification(userId: string, email: string): Promise<{
    token: string;
    pin: string;
  }> {
    const token = this.generateToken();
    const pin = this.generatePin();
    const expires = new Date(Date.now() + emailConfig.verificationTokenExpiry);

    // Check if this email already exists for this user
    const existingEmail = await prisma.alertEmail.findFirst({
      where: { 
        userId,
        email
      }
    });

    if (existingEmail) {
      // Update the existing email record
      await prisma.alertEmail.update({
        where: { id: existingEmail.id },
        data: {
          status: 'pending verification',
          verificationToken: token,
          verificationPin: pin,
          verificationExpires: expires,
          verificationAttempts: 0,
          updatedAt: new Date()
        }
      });
    } else {
      // Create a new email record
      await prisma.alertEmail.create({
        data: {
          userId,
          email,
          status: 'pending verification',
          verificationToken: token,
          verificationPin: pin,
          verificationExpires: expires,
          verificationAttempts: 0
        }
      });
    }

    // If this is the user's first email, update the user record
    const userEmails = await prisma.alertEmail.count({
      where: { userId }
    });

    if (userEmails === 1) {
      await prisma.user.update({
        where: { id: userId },
        data: { 
          updatedAt: new Date() 
        }
      });
    }

    return { token, pin };
  }

  async verifyEmail(
    userId: string,
    tokenOrPin: string
  ): Promise<{ success: boolean; message: string }> {
    // Find the pending verification email
    const pendingEmail = await prisma.alertEmail.findFirst({
      where: { 
        userId,
        status: 'pending verification'
      }
    });
  
    if (!pendingEmail) {
      return { success: false, message: 'Verification not found' };
    }
  
    if (pendingEmail.verificationAttempts >= emailConfig.maxVerificationAttempts) {
      return { success: false, message: 'Too many verification attempts' };
    }
  
    if (pendingEmail.verificationExpires! < new Date()) {
      return { success: false, message: 'Verification expired' };
    }
  
    const isValid =
      pendingEmail.verificationToken === tokenOrPin ||
      pendingEmail.verificationPin === tokenOrPin;
  
    if (!isValid) {
      // Increment verification attempts
      await prisma.alertEmail.update({
        where: { id: pendingEmail.id },
        data: {
          verificationAttempts: { increment: 1 },
        },
      });
      return { success: false, message: 'Invalid verification code' };
    }
  
    // This method already sets to active, so no changes needed here
    // Get current active email if any
    const activeEmail = await prisma.alertEmail.findFirst({
      where: { 
        userId,
        status: 'active'
      }
    });
  
    // Start a transaction to update email statuses
    await prisma.$transaction(async (tx: { alertEmail: { update: (arg0: { where: { id: any; } | { id: any; }; data: { status: string; updatedAt: Date; } | { status: string; verificationToken: null; verificationPin: null; verificationExpires: null; updatedAt: Date; }; }) => any; }; user: { update: (arg0: { where: { id: string; }; data: { updatedAt: Date; }; }) => any; }; }) => {
      // If there's an active email, change it to 'ready' status
      if (activeEmail) {
        await tx.alertEmail.update({
          where: { id: activeEmail.id },
          data: { 
            status: 'ready',
            updatedAt: new Date()
          }
        });
      }
  
      // Update the verified email to active status
      await tx.alertEmail.update({
        where: { id: pendingEmail.id },
        data: {
          status: 'active',
          verificationToken: null,
          verificationPin: null,
          verificationExpires: null,
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
  
    return { success: true, message: 'Email verified successfully' };
  }
  
  async verifyEmailById(
    userId: string,
    emailId: string,
    otp: string
  ): Promise<{ success: boolean; message: string; email?: any }> {
    // Find the specific email by ID
    const emailToVerify = await prisma.alertEmail.findFirst({
      where: { 
        id: emailId,
        userId
      }
    });
  
    if (!emailToVerify) {
      return { success: false, message: 'Email not found' };
    }
  
    if (emailToVerify.status !== 'pending verification') {
      return { success: false, message: 'Email is not pending verification' };
    }
  
    if (emailToVerify.verificationAttempts >= emailConfig.maxVerificationAttempts) {
      return { success: false, message: 'Too many verification attempts' };
    }
  
    if (emailToVerify.verificationExpires! < new Date()) {
      return { success: false, message: 'Verification code expired' };
    }
  
    const isValid =
      emailToVerify.verificationToken === otp ||
      emailToVerify.verificationPin === otp;
  
    if (!isValid) {
      // Increment verification attempts
      await prisma.alertEmail.update({
        where: { id: emailId },
        data: {
          verificationAttempts: { increment: 1 },
        },
      });
      return { success: false, message: 'Invalid verification code' };
    }
  
    // Count total emails for this user
    const totalEmails = await prisma.alertEmail.count({
      where: { userId }
    });
  
    // Check if there's already an active email
    const hasActiveEmail = await prisma.alertEmail.findFirst({
      where: { 
        userId,
        status: 'active'
      }
    });
  
    // If this is the only email or there's no active email, set to active
    const newStatus = (totalEmails === 1 || !hasActiveEmail) ? 'active' : 'ready';
  
    // Start a transaction to ensure consistent updates
    await prisma.$transaction(async (tx: { alertEmail: { update: (arg0: { where: { id: any; } | { id: string; }; data: { status: string; updatedAt: Date; } | { status: string; verificationToken: null; verificationPin: null; verificationExpires: null; updatedAt: Date; }; }) => any; }; }) => {
      // If setting this email to active and there's already an active email,
      // update the currently active email to ready
      if (newStatus === 'active' && hasActiveEmail) {
        await tx.alertEmail.update({
          where: { id: hasActiveEmail.id },
          data: { 
            status: 'ready',
            updatedAt: new Date()
          }
        });
      }
  
      // Update the verified email
      await tx.alertEmail.update({
        where: { id: emailId },
        data: {
          status: newStatus,
          verificationToken: null,
          verificationPin: null,
          verificationExpires: null,
          updatedAt: new Date()
        }
      });
    });
  
    // Get the updated email
    const updatedEmail = await prisma.alertEmail.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });
  
    return { 
      success: true, 
      message: 'Email verified successfully',
      email: updatedEmail
    };
  }
  
  async verifyEmailWithToken(
    token: string
  ): Promise<{ success: boolean; message: string; email?: any }> {
    // Find the pending verification email with this token
    const pendingEmail = await prisma.alertEmail.findFirst({
      where: { 
        verificationToken: token,
        status: 'pending verification'
      }
    });
  
    if (!pendingEmail) {
      return { success: false, message: 'Invalid or expired verification link' };
    }
  
    if (pendingEmail.verificationExpires! < new Date()) {
      return { success: false, message: 'Verification link has expired' };
    }
  
    // Count total emails for this user
    const totalEmails = await prisma.alertEmail.count({
      where: { verificationToken: token }
    });
  
    // Check if there's already an active email
    const hasActiveEmail = await prisma.alertEmail.findFirst({
      where: { 
        verificationToken: token,
        status: 'active'
      }
    });
  
    // If this is the only email or there's no active email, set to active
    const newStatus = (totalEmails === 1 || !hasActiveEmail) ? 'active' : 'ready';
  
    // Start a transaction to ensure consistent updates
    await prisma.$transaction(async (tx: { alertEmail: { update: (arg0: { where: { id: any; } | { id: any; }; data: { status: string; updatedAt: Date; } | { status: string; verificationToken: null; verificationPin: null; verificationExpires: null; updatedAt: Date; }; }) => any; }; }) => {
      // If setting this email to active and there's already an active email,
      // update the currently active email to ready
      if (newStatus === 'active' && hasActiveEmail) {
        await tx.alertEmail.update({
          where: { id: hasActiveEmail.id },
          data: { 
            status: 'ready',
            updatedAt: new Date()
          }
        });
      }
  
      // Update the verified email
      await tx.alertEmail.update({
        where: { id: pendingEmail.id },
        data: {
          status: newStatus,
          verificationToken: null,
          verificationPin: null,
          verificationExpires: null,
          updatedAt: new Date()
        }
      });
    });
  
    // Get the updated email
    const updatedEmail = await prisma.alertEmail.findUnique({
      where: { id: pendingEmail.id },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });
  
    return { 
      success: true, 
      message: 'Email verified successfully',
      email: updatedEmail
    };
  }
  

  async resendVerificationCode(
    userId: string,
    emailId: string
  ): Promise<{ success: boolean; message: string; token?: string; pin?: string }> {
    // Find the email
    const email = await prisma.alertEmail.findFirst({
      where: { 
        id: emailId,
        userId
      }
    });

    if (!email) {
      return { success: false, message: 'Email not found' };
    }

    if (email.status !== 'pending verification') {
      return { success: false, message: 'Email is not pending verification' };
    }

    // Check for rate limiting of resend requests
    // This could be implemented with Redis similar to other rate limits
    // For now, using a simple time-based check
    const lastUpdate = email.updatedAt;
    const now = new Date();
    const minutesSinceLastUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);

    if (minutesSinceLastUpdate < 2) { // Only allow resend every 2 minutes
      return { success: false, message: 'Please wait before requesting another code' };
    }

    // Generate new verification tokens
    const token = this.generateToken();
    const pin = this.generatePin();
    const expires = new Date(Date.now() + emailConfig.verificationTokenExpiry);

    // Update the email with new verification tokens
    await prisma.alertEmail.update({
      where: { id: emailId },
      data: {
        verificationToken: token,
        verificationPin: pin,
        verificationExpires: expires,
        verificationAttempts: 0, // Reset attempts
        updatedAt: new Date()
      }
    });

    return { 
      success: true, 
      message: 'New verification code generated',
      token,
      pin
    };
  }
}
