import { Request, Response, NextFunction } from 'express';
import { MonitorService } from '../services/monitor.service';

export class MonitorController {
  constructor(private monitorService: MonitorService) {}

  async createMonitor(req: Request, res: Response, next: NextFunction) {
    try {
      const monitor = await this.monitorService.createMonitor(
        req.user.id,
        req.body
      );
      res.status(201).json(monitor);
    } catch (error) {
      next(error);
    }
  }
}