import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  validateResearchSearch,
  validateItemId,
} from '../middleware/validation/research.validation';
import { ResearchController } from '../controllers/research.controller';
import { AppContainer } from '../container';

export function createResearchRouter(c: AppContainer): Router {
  const router = Router();

  const researchController = new ResearchController(c.researchService);

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

  return router;
}
