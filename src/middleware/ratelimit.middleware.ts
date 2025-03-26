// src/middleware/ratelimit.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { RateLimitService } from '../services/ratelimit.service';
import { Redis } from 'ioredis';

export function createRateLimitMiddleware(redis: Redis) {
  const rateLimitService = new RateLimitService(redis);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip rate limiting for non-authenticated routes
      if (!req.user?.id) {
        return next();
      }

      const userId = req.user.id;
      const isAllowed = await rateLimitService.checkApiRateLimit(userId);

      if (!isAllowed) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'You have exceeded your hourly API call limit. Please try again later.'
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}