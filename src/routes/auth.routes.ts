import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import {
  validateRegister,
  validateLogin,
  validateVerify,
  validateForgotPassword,
} from '../middleware/validation/auth.validation';
import { AppContainer } from '../container';

export function createAuthRouter(c: AppContainer): Router {
  const router = Router();

  const authController = new AuthController(c.authService, c.emailService);

  // Register new user
  router.post('/register', validateRegister, authController.register.bind(authController));

  // Login
  router.post('/login', validateLogin, authController.login.bind(authController));

  // Verify email
  router.post(
    '/verify',
    c.rateLimitMiddleware,
    validateVerify,
    authController.verifyEmail.bind(authController)
  );

  // Forgot password
  router.post(
    '/forgot-password',
    c.rateLimitMiddleware,
    validateForgotPassword,
    authController.forgotPassword.bind(authController)
  );

  return router;
}
