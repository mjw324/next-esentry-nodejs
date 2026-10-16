import { Request, Response, NextFunction } from 'express';
import { ResearchService } from '../services/research.service';
import { NotFoundError, RateLimitError } from '../utils/errors';

/**
 * HTTP handlers for /api/research. Validation has already run; quota exhaustion
 * surfaces as 429 and an ended or missing listing as 404, everything else flows
 * to the shared error handler.
 */
export class ResearchController {
  constructor(private researchService: ResearchService) {}

  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await this.researchService.search(req.body));
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  async item(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const zip = typeof req.query.zip === 'string' && /^\d{5}$/.test(req.query.zip)
        ? req.query.zip
        : undefined;
      res.status(200).json(await this.researchService.getItem(String(req.params.id), zip));
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  private handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: 'Rate limit exceeded', message: error.message });
      return;
    }
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: 'Not found', message: error.message });
      return;
    }
    next(error);
  }
}
