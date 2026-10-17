import { Redis } from 'ioredis';
import { RequestHandler } from 'express';

import { RateLimitService } from './services/ratelimit.service';
import { EbayAuthService } from './services/ebay-auth.service';
import { EbayService } from './services/ebay.service';
import { CacheService } from './services/cache.service';
import { EmailService } from './services/email.service';
import { VerificationService } from './services/verification.service';
import { NotificationService } from './services/notification.service';
import { ComparisonService } from './services/comparison.service';
import { MonitorService } from './services/monitor.service';
import { InsightsService } from './services/insights.service';
import { ResearchService } from './services/research.service';
import { SoldTrackerService } from './services/sold-tracker.service';
import { AuthService } from './services/auth.service';
import { CleanupService } from './services/cleanup.service';
import { MonitorQueue } from './queues/monitor.queue';
import { createRateLimitMiddleware } from './middleware/ratelimit.middleware';

/**
 * The application's service graph, built exactly once.
 *
 * Previously index.ts and each of the four route modules built their own:
 * every route file ran `new Redis(redisConfig)` at import time, plus its own
 * EbayAuthService (each firing checkEnvironmentChange on construction), its own
 * MonitorQueue (which opens a further BullMQ connection and ignores the redis
 * argument handed to it), RateLimitService, CacheService, EmailService and
 * VerificationService.
 *
 * Production showed 10 Redis clients for this one small process, four SES
 * clients, and four redundant writes of `ebay:current_environment` at boot. It
 * also meant importing a route module performed I/O as a side effect, which
 * makes the process impossible to unit test.
 */
export interface AppContainer {
  redis: Redis;
  rateLimitService: RateLimitService;
  ebayAuthService: EbayAuthService;
  ebayService: EbayService;
  cacheService: CacheService;
  emailService: EmailService;
  verificationService: VerificationService;
  notificationService: NotificationService;
  comparisonService: ComparisonService;
  monitorQueue: MonitorQueue;
  monitorService: MonitorService;
  insightsService: InsightsService;
  researchService: ResearchService;
  soldTrackerService: SoldTrackerService;
  authService: AuthService;
  cleanupService: CleanupService;
  rateLimitMiddleware: RequestHandler;
}

export function createContainer(redis: Redis): AppContainer {
  const rateLimitService = new RateLimitService(redis);
  const ebayAuthService = new EbayAuthService(redis);
  const ebayService = new EbayService(ebayAuthService, redis);
  const cacheService = new CacheService(redis);
  const emailService = new EmailService();
  const verificationService = new VerificationService();

  const notificationService = new NotificationService(rateLimitService, emailService);
  const comparisonService = new ComparisonService(notificationService, emailService);

  const monitorQueue = new MonitorQueue(redis);
  const monitorService = new MonitorService(
    rateLimitService,
    monitorQueue,
    cacheService
  );

  const insightsService = new InsightsService(ebayService, cacheService);
  const researchService = new ResearchService(ebayService, cacheService);
  const soldTrackerService = new SoldTrackerService(ebayService, redis);
  const authService = new AuthService(verificationService);
  const cleanupService = new CleanupService();

  return {
    redis,
    rateLimitService,
    ebayAuthService,
    ebayService,
    cacheService,
    emailService,
    verificationService,
    notificationService,
    comparisonService,
    monitorQueue,
    monitorService,
    insightsService,
    researchService,
    soldTrackerService,
    authService,
    cleanupService,
    rateLimitMiddleware: createRateLimitMiddleware(rateLimitService),
  };
}
