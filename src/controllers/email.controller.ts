// src/controllers/email.controller.ts
import { Request, Response, NextFunction } from 'express';
import { EmailService } from '../services/email.service';
import { VerificationService } from '../services/verification.service';

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
}
