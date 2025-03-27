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

    // Store the verification token
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: verificationToken,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
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
    // Find the verification token
    const verificationRecord = await prisma.verificationToken.findFirst({
      where: {
        token,
        expires: { gt: new Date() },
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

    // Delete the used token
    await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: verificationRecord.identifier,
          token,
        },
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

    return { user, isValid };
  }

  /**
   * Create a password reset token
   * @param email User's email
   * @returns The generated reset token
   */
  async createPasswordResetToken(email: string) {
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Store the reset token
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: resetToken,
        expires: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour
      },
    });

    return resetToken;
  }
}
