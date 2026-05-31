import { Router } from 'express';
import { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { authMiddleware } from '../middleware/auth.middleware';
import { createRateLimitMiddleware } from '../middleware/ratelimit.middleware';
import { validateInsightsParams } from '../middleware/validation/insights.validation';
import { EbayAuthService } from '../services/ebay-auth.service';
import { EbayService } from '../services/ebay.service';
import { CacheService } from '../services/cache.service';
import { InsightsService } from '../services/insights.service';
import { InsightsController } from '../controllers/insights.controller';

const router = Router();

// Mirror monitor.routes.ts: each route file owns its service graph.
const redis = new Redis(redisConfig);

const rateLimitMiddleware = createRateLimitMiddleware(redis);
const ebayAuthService = new EbayAuthService(redis);
const ebayService = new EbayService(ebayAuthService, redis);
const cacheService = new CacheService(redis);
const insightsService = new InsightsService(ebayService, cacheService);
const insightsController = new InsightsController(insightsService);

// Same protection as the monitor routes: authenticated + per-user rate limited.
router.use(authMiddleware, rateLimitMiddleware);

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

export default router;
