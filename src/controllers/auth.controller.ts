import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { EmailService } from '../services/email.service';
import { prisma } from '../lib/prisma';

export class AuthController {
  constructor(
    private authService: AuthService,
    private emailService: EmailService
  ) {}

  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });

      if (existingUser) {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }

      // Register the user and create verification token
      const { user, verificationToken } = await this.authService.registerUser(email, password);

      // Send account verification email
      await this.emailService.sendAccountVerificationEmail(email, verificationToken);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        userId: user.id
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;

      // Verify the token
      const user = await this.authService.verifyEmail(token);

      if (!user) {
        res.status(400).json({ error: 'Invalid or expired verification token' });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Email verified successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
  
      // Attempt to authenticate the user
      const { user, isValid } = await this.authService.validateUser(email, password);
  
      if (!user || !isValid) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
  
      // Check if email is verified by checking for an active alert email, which is automatically set when user is verified
      const hasVerifiedEmail = await prisma.alertEmail.findFirst({
        where: { 
          userId: user.id,
          email: user.email,
          status: 'active'
        }
      });
  
      if (!hasVerifiedEmail) {
        res.status(403).json({ error: 'Please verify your email before logging in' });
        return;
      }
  
      // Update last login time
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoggedIn: new Date() }
      });
  
      // Return user data (excluding password)
      const { password: _, ...userData } = user;
  
      res.status(200).json({
        success: true,
        user: userData
      });
    } catch (error) {
      next(error);
    }
  }
  

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        // For security reasons, don't reveal if the email exists or not
        res.status(200).json({
          success: true,
          message: 'If an account with that email exists, we sent password reset instructions'
        });
        return;
      }

      // Generate password reset token
      const resetToken = await this.authService.createPasswordResetToken(email);

      // Send password reset email
      await this.emailService.sendPasswordResetEmail(email, resetToken);

      res.status(200).json({
        success: true,
        message: 'If an account with that email exists, we sent password reset instructions'
      });
    } catch (error) {
      next(error);
    }
  }
}
