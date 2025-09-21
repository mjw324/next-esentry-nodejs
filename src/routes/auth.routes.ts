import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validateRegister, validateLogin, validateVerify, validateForgotPassword } from '../middleware/validation/auth.validation';
import { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { EmailService } from '../services/email.service';
import { VerificationService } from '../services/verification.service';
import { AuthService } from '../services/auth.service';
import { createRateLimitMiddleware } from '../middleware/ratelimit.middleware';

const router = Router();

const redis = new Redis(redisConfig);

const rateLimitMiddleware = createRateLimitMiddleware(redis);

const emailService = new EmailService();
const verificationService = new VerificationService();
const authService = new AuthService(verificationService);
const authController = new AuthController(authService, emailService);

// Register new user
router.post(
  '/register',
  validateRegister,
  authController.register.bind(authController)
);

// Login
router.post(
  '/login',
  validateLogin,
  authController.login.bind(authController)
);

// Verify email
router.post(
  '/verify',
  rateLimitMiddleware,
  validateVerify,
  authController.verifyEmail.bind(authController)
);

// Forgot password
router.post(
  '/forgot-password',
  rateLimitMiddleware,
  validateForgotPassword,
  authController.forgotPassword.bind(authController)
);

export default router;
