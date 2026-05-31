import { Request, Response, NextFunction } from 'express';
import { InsightsService } from '../services/insights.service';
import { EbaySearchParams } from '../types/ebay.types';
import { RateLimitError } from '../utils/errors';

/**
 * HTTP handlers for the Active Market Insights endpoints. Thin: validate has
 * already run, so each method maps the request body to EbaySearchParams, calls
 * the service, and returns the result. Quota exhaustion surfaces as 429 here
 * (the shared error handler returns 500), everything else flows to next().
 */
export class InsightsController {
  constructor(private insightsService: InsightsService) {}

  async market(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const snapshot = await this.insightsService.getMarketSnapshot(this.toParams(req.body));
      res.status(200).json(snapshot);
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  async outliers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.insightsService.getOutliers(this.toParams(req.body));
      res.status(200).json(result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  async calibrate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const summary = await this.insightsService.getCalibration(this.toParams(req.body));
      res.status(200).json(summary);
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  /** Map a validated request body onto the existing EbaySearchParams shape. */
  private toParams(body: any): EbaySearchParams {
    return {
      keywords: body.keywords,
      excludedKeywords: body.excludedKeywords ?? [],
      minPrice: body.minPrice,
      maxPrice: body.maxPrice,
      conditions: body.conditions ?? [],
      sellers: body.sellers ?? [],
    };
  }

  private handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: 'Rate limit exceeded', message: error.message });
      return;
    }
    next(error);
  }
}
