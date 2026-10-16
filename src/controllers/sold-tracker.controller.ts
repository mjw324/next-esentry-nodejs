import { Request, Response, NextFunction } from 'express';
import { SoldTrackerService } from '../services/sold-tracker.service';
import { NotFoundError, RateLimitError } from '../utils/errors';

/** HTTP handlers for /api/research/tracks. Validation has already run. */
export class SoldTrackerController {
  constructor(private soldTrackerService: SoldTrackerService) {}

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(201).json(await this.soldTrackerService.createTrack(req.user.id, req.body));
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await this.soldTrackerService.listTracks(req.user.id));
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  async sales(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '90'), 10) || 90, 1), 365);
      res
        .status(200)
        .json(await this.soldTrackerService.getSales(req.user.id, String(req.params.id), days));
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const removed = await this.soldTrackerService.deleteTrack(req.user.id, String(req.params.id));
      if (!removed) {
        res.status(404).json({ error: 'Not found', message: 'Track not found' });
        return;
      }
      res.status(204).end();
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
