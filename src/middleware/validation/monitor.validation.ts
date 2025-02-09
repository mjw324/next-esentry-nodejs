import { Request, Response, NextFunction } from 'express';
import { createMonitorSchema } from '../../types/monitor.types';

export const validateCreateMonitor = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    createMonitorSchema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid monitor data' });
  }
};
