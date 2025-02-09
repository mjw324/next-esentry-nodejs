import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { emailConfig } from '../config/email';

export class VerificationService {
  constructor(private prisma: PrismaClient) { }

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

    await this.prisma.notificationSettings.upsert({
      where: { userId },
      update: {
        emailAddress: email,
        emailVerificationToken: token,
        emailVerificationPin: pin,
        emailVerificationExpires: expires,
        emailVerificationAttempts: 0,
        emailEnabled: false,
        emailVerified: false,
      },
      create: {
        userId,
        emailAddress: email,
        emailVerificationToken: token,
        emailVerificationPin: pin,
        emailVerificationExpires: expires,
      },
    });

    return { token, pin };
  }

  async verifyEmail(
    userId: string,
    tokenOrPin: string
  ): Promise<{ success: boolean; message: string }> {
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      return { success: false, message: 'Verification not found' };
    }

    if (settings.emailVerified) {
      return { success: false, message: 'Email already verified' };
    }

    if (settings.emailVerificationAttempts >= emailConfig.maxVerificationAttempts) {
      return { success: false, message: 'Too many verification attempts' };
    }

    if (settings.emailVerificationExpires! < new Date()) {
      return { success: false, message: 'Verification expired' };
    }

    const isValid =
      settings.emailVerificationToken === tokenOrPin ||
      settings.emailVerificationPin === tokenOrPin;

    if (!isValid) {
      await this.prisma.notificationSettings.update({
        where: { userId },
        data: {
          emailVerificationAttempts: { increment: 1 },
        },
      });
      return { success: false, message: 'Invalid verification code' };
    }

    await this.prisma.notificationSettings.update({
      where: { userId },
      data: {
        emailVerified: true,
        emailEnabled: true,
        emailVerificationToken: null,
        emailVerificationPin: null,
        emailVerificationExpires: null,
      },
    });

    return { success: true, message: 'Email verified successfully' };
  }
}
