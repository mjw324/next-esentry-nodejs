import { Router } from 'express';
import { MonitorController } from '../controllers/monitor.controller';
import { validateCreateMonitor } from '../middleware/validation/monitor.validation';
import { authMiddleware } from '../middleware/auth.middleware';
import { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { MonitorQueue } from '../queues/monitor.queue';
import { RateLimitService } from '../services/ratelimit.service';
import { MonitorService } from '../services/monitor.service';
import { EbayAuthService } from '../services/ebay-auth.service';
import { EbayService } from '../services/ebay.service';
import { EmailService } from '../services/email.service';
import { VerificationService } from '../services/verification.service';
import { createRateLimitMiddleware } from '../middleware/ratelimit.middleware';

const router = Router();

const redis = new Redis(redisConfig);

const rateLimitMiddleware = createRateLimitMiddleware(redis);
const ebayAuthService = new EbayAuthService(redis);
const ebayService = new EbayService(ebayAuthService);
const monitorQueue = new MonitorQueue(redis);
const rateLimitService = new RateLimitService(redis);
const monitorService = new MonitorService(rateLimitService, monitorQueue);
const emailService = new EmailService();
const verificationService = new VerificationService();
const monitorController = new MonitorController(monitorService, emailService, verificationService);

router.use(authMiddleware, rateLimitMiddleware);

router.post(
  '/',
  validateCreateMonitor,
  monitorController.createMonitor.bind(monitorController)
);

router.get(
  '/',
  monitorController.getUserMonitors.bind(monitorController)
);

router.patch(
  '/:id/toggle',
  monitorController.toggleMonitorStatus.bind(monitorController)
);

router.patch(
  '/:id',
  monitorController.updateMonitor.bind(monitorController)
);

router.delete(
  '/:id',
  monitorController.deleteMonitor.bind(monitorController)
);

// Test ebay API
router.get(
  '/test-ebay',
  async (req, res, next) => {
    try {
      const testParams = {
        keywords: ['iphone'],
        excludedKeywords: ['case', 'screen protector'],
        minPrice: 100,
        maxPrice: 1000,
        conditions: ['NEW'],
        sellers: [],
      };

      const results = await ebayService.searchItems(testParams);
      res.json(results);
    } catch (error) {
      next(error);
    }
  }
);


export default router;