// src/middleware/ratelimit.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { RateLimitService } from '../services/ratelimit.service';

// Takes the shared RateLimitService rather than a Redis client: it used to
// construct its own per route module, so each copy kept a separate per-user
// limit cache and Redis connection.
export function createRateLimitMiddleware(rateLimitService: RateLimitService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip rate limiting for non-authenticated routes
      if (!req.user?.id) {
        return next();
      }

      // Personal access tokens are the owner's own scripts (the shopping
      // workspace). The hourly cap counted every request they made, cache hits
      // and monitor listings included, and locked them out at 50/hour. What
      // actually needs protecting is eBay's daily quota, and EbayService guards
      // every on-demand Browse call against that (assertQuota).
      if (req.user.personalToken) {
        return next();
      }

      const userId = req.user.id;
      const isAllowed = await rateLimitService.checkApiRateLimit(userId);

      if (!isAllowed) {
        // Must return: without it next() ran the handler anyway, which then
        // tried to respond a second time (ERR_HTTP_HEADERS_SENT).
        res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'You have exceeded your hourly API call limit. Please try again later.'
        });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}