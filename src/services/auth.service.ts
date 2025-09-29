import { prisma } from '../lib/prisma';
import { VerificationService } from './verification.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

export class AuthService {
  constructor(
    private verificationService: VerificationService
  ) {}

  /**
   * Register a new user
   * @param email User's email
   * @param password User's password
   * @returns The created user and verification token
   */
  async registerUser(email: string, password: string) {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Store the verification token using the 'verification' model
    await prisma.verification.create({
      data: {
        identifier: email,
        value: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    return { user, verificationToken };
  }

  /**
   * Verify a user's email
   * @param token Verification token
   * @returns The updated user if verification was successful, null otherwise
   */
  async verifyEmail(token: string) {
    // Find the verification record
    const verificationRecord = await prisma.verification.findFirst({
      where: {
        value: token,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationRecord) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { email: verificationRecord.identifier },
    });

    if (!user) {
      return null;
    }

    // Update user to mark email as verified
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    // Delete the used verification record
    await prisma.verification.delete({
      where: {
        id: verificationRecord.id,
      },
    });

    // Add the verified email as an active alert email
    await prisma.alertEmail.upsert({
      where: {
        userId_email: {
          userId: user.id,
          email: user.email
        }
      },
      update: {
        // If it somehow already exists, ensure it's active
        status: "active"
      },
      create: {
        userId: user.id,
        email: user.email,
        status: "active"
      }
    });

    return user;
  }

  /**
   * Validate user credentials
   * @param email User's email
   * @param password User's password
   * @returns Object containing user and isValid flag
   */
  async validateUser(email: string, password: string) {
    // Find the user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      return { user: null, isValid: false };
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    
    if (isValid) {
      // Update last logged in time
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoggedIn: new Date() }
      });
    }

    return { user, isValid };
  }

  /**
   * Create a password reset token
   * @param email User's email
   * @returns The generated reset token
   */
  async createPasswordResetToken(email: string) {
    // First check if user exists (optional - for security you might not want to reveal this)
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      // Return null or throw error based on your security requirements
      // (sometimes you don't want to reveal if an email exists)
      return null;
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Store the reset token using the 'verification' model
    await prisma.verification.create({
      data: {
        identifier: email,
        value: resetToken,
        expiresAt: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour
      },
    });

    return resetToken;
  }

  /**
   * Reset user password
   * @param token Reset token
   * @param newPassword New password
   * @returns The updated user if reset was successful, null otherwise
   */
  async resetPassword(token: string, newPassword: string) {
    // Find the verification record
    const verificationRecord = await prisma.verification.findFirst({
      where: {
        value: token,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationRecord) {
      return null;
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password
    const user = await prisma.user.update({
      where: { email: verificationRecord.identifier },
      data: { password: hashedPassword },
    });

    // Delete the used verification record
    await prisma.verification.delete({
      where: {
        id: verificationRecord.id,
      },
    });

    return user;
  }
}