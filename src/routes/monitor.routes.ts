import { Router } from 'express';
import { MonitorController } from '../controllers/monitor.controller';
import { validateCreateMonitor } from '../middleware/validation/monitor.validation';
import { authMiddleware } from '../middleware/auth.middleware';
import { AppContainer } from '../container';

export function createMonitorRouter(c: AppContainer): Router {
  const router = Router();

  const monitorController = new MonitorController(
    c.monitorService,
    c.emailService,
    c.verificationService
  );

  router.use(authMiddleware, c.rateLimitMiddleware);

  router.post(
    '/',
    validateCreateMonitor,
    monitorController.createMonitor.bind(monitorController)
  );

  router.get('/', monitorController.getUserMonitors.bind(monitorController));

  router.patch(
    '/:id/toggle',
    monitorController.toggleMonitorStatus.bind(monitorController)
  );

  router.patch('/:id', monitorController.updateMonitor.bind(monitorController));

  router.delete('/:id', monitorController.deleteMonitor.bind(monitorController));

  // The /test-ebay route was removed here: it issued a real Browse call
  // against the shared application quota on every request, with a hardcoded
  // iPhone search, and served no purpose in production.

  return router;
}
