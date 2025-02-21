import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import { EmailService } from '../services/email.service';
import { VerificationService } from '../services/verification.service';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { validateEmailSetup } from '../middleware/validation/email.validation';

const router = Router();

const emailService = new EmailService();
const verificationService = new VerificationService();
const emailController = new EmailController(emailService, verificationService);

router.post(
  '/setup',
  authMiddleware,
  validateEmailSetup,
  emailController.setupEmail
);

router.post(
  '/verify',
  authMiddleware,
  emailController.verifyEmail
);

export default router;
