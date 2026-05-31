import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Insights endpoints take the same search-param shape as a monitor (minus the
// monitor-only fields like interval/email). Keywords are required; everything
// else is optional and defaulted to empty arrays in the controller.
export const insightsParamsSchema = z.object({
  keywords: z.array(z.string()).min(1),
  excludedKeywords: z.array(z.string()).optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  conditions: z.array(z.string()).optional(),
  sellers: z.array(z.string()).optional(),
});

export const validateInsightsParams = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    insightsParamsSchema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid insights parameters' });
  }
};
