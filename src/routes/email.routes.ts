import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import { EmailService } from '../services/email.service';
import { VerificationService } from '../services/verification.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { validateEmailSetup, validateOtpBody } from '../middleware/validation/email.validation';
import { createRateLimitMiddleware } from '../middleware/ratelimit.middleware';
import { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';

const router = Router();

const redis = new Redis(redisConfig);

const rateLimitMiddleware = createRateLimitMiddleware(redis);
const emailService = new EmailService();
const verificationService = new VerificationService();
const emailController = new EmailController(emailService, verificationService);

// Public route for token verification (no auth required)
router.post(
  '/verify-token',
  rateLimitMiddleware,
  emailController.verifyToken
);

router.use(authMiddleware, rateLimitMiddleware);

router.get(
  '/',
  emailController.getUserEmails
);

router.post(
  '/',
  validateEmailSetup,
  emailController.addAlertEmail
);

router.put(
  '/:emailId/set-active',
  emailController.setEmailActive
);

router.delete(
  '/:emailId',
  emailController.deleteAlertEmail
);

router.post(
  '/:emailId/verify',
  validateOtpBody,
  emailController.verifyEmailById
);

router.post(
  '/:emailId/resend-code',
  emailController.resendVerificationCode
);

router.get(
  '/:emailId/status',
  emailController.getEmailStatus
);


export default router;
