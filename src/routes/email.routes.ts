import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  validateEmailSetup,
  validateOtpBody,
} from '../middleware/validation/email.validation';
import { AppContainer } from '../container';

export function createEmailRouter(c: AppContainer): Router {
  const router = Router();

  const emailController = new EmailController(
    c.emailService,
    c.verificationService
  );

  // Public route for token verification (no auth required)
  router.post('/verify-token', c.rateLimitMiddleware, emailController.verifyToken);

  router.use(authMiddleware, c.rateLimitMiddleware);

  router.get('/', emailController.getUserEmails);

  router.post('/', validateEmailSetup, emailController.addAlertEmail);

  router.put('/:emailId/set-active', emailController.setEmailActive);

  router.delete('/:emailId', emailController.deleteAlertEmail);

  router.post('/:emailId/verify', validateOtpBody, emailController.verifyEmailById);

  router.post('/:emailId/resend-code', emailController.resendVerificationCode);

  router.get('/:emailId/status', emailController.getEmailStatus);

  return router;
}
