import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Insights endpoints take the same search-param shape as a monitor (minus the
// monitor-only fields like interval/email). Keywords are required; everything
// else is optional and defaulted to empty arrays in the controller.
export const insightsParamsSchema = z.object({
  keywords: z.array(z.string()).min(1),
  excludedKeywords: z.array(z.string()).optional(),
  // nullish, not optional: the frontend's insights panel sends `null` for an
  // unset price (paramsKey in useDebouncedParams.ts), and every insights call
  // for a monitor without a full price range was rejected with 400 (R-8).
  minPrice: z.number().min(0).nullish(),
  maxPrice: z.number().min(0).nullish(),
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
