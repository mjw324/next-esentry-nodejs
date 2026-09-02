import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { validateInsightsParams } from '../middleware/validation/insights.validation';
import { InsightsController } from '../controllers/insights.controller';
import { AppContainer } from '../container';

export function createInsightsRouter(c: AppContainer): Router {
  const router = Router();

  const insightsController = new InsightsController(c.insightsService);

  // Same protection as the monitor routes: authenticated + per-user rate limited.
  router.use(authMiddleware, c.rateLimitMiddleware);

  // Phase 1 — current-market snapshot.
  router.post(
    '/market',
    validateInsightsParams,
    insightsController.market.bind(insightsController)
  );

  // Phase 2 — outlier detection + refinement suggestions.
  router.post(
    '/outliers',
    validateInsightsParams,
    insightsController.outliers.bind(insightsController)
  );

  // Phase 3 — composed calibration summary for the create-monitor form.
  router.post(
    '/calibrate',
    validateInsightsParams,
    insightsController.calibrate.bind(insightsController)
  );

  return router;
}
