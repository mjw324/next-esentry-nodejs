import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  validateResearchSearch,
  validateItemId,
  validateSoldTrack,
  validateTrackId,
} from '../middleware/validation/research.validation';
import { ResearchController } from '../controllers/research.controller';
import { SoldTrackerController } from '../controllers/sold-tracker.controller';
import { AppContainer } from '../container';

export function createResearchRouter(c: AppContainer): Router {
  const router = Router();

  const researchController = new ResearchController(c.researchService);
  const soldTrackerController = new SoldTrackerController(c.soldTrackerService);

  // Same protection as insights: authenticated + per-user rate limited.
  router.use(authMiddleware, c.rateLimitMiddleware);

  router.post(
    '/search',
    validateResearchSearch,
    researchController.search.bind(researchController)
  );

  router.get(
    '/item/:id',
    validateItemId,
    researchController.item.bind(researchController)
  );

  // Sold-price tracking from auction results.
  router.get('/tracks', soldTrackerController.list.bind(soldTrackerController));
  router.post(
    '/tracks',
    validateSoldTrack,
    soldTrackerController.create.bind(soldTrackerController)
  );
  router.get(
    '/tracks/:id/sales',
    validateTrackId,
    soldTrackerController.sales.bind(soldTrackerController)
  );
  router.delete(
    '/tracks/:id',
    validateTrackId,
    soldTrackerController.remove.bind(soldTrackerController)
  );

  return router;
}
