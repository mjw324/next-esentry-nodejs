import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CONDITION_NAMES } from '../../utils/conditions';

const condition = z.union([
  z.string().regex(/^\d{4}$/),
  z
    .string()
    .transform((s) => s.toUpperCase())
    .refine((s) => CONDITION_NAMES.includes(s), { message: 'unknown condition' }),
]);

export const researchSearchSchema = z.object({
  q: z.string().trim().min(1).max(350),
  conditions: z.array(condition).max(10).optional(),
  categoryIds: z.array(z.string().regex(/^\d+$/)).max(1).optional(),
  excludeCategoryIds: z.array(z.string().regex(/^\d+$/)).max(20).optional(),
  buyingOptions: z.array(z.enum(['FIXED_PRICE', 'AUCTION', 'BEST_OFFER'])).max(3).optional(),
  minPrice: z.number().min(0).nullish(),
  maxPrice: z.number().min(0).nullish(),
  excludedKeywords: z.array(z.string().max(60)).max(40).optional(),
  aspects: z.record(z.string().max(60), z.array(z.string().max(80)).max(10)).optional(),
  sort: z.enum(['best', 'price', '-price', 'newlyListed', 'endingSoonest']).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  usOnly: z.boolean().optional(),
  freeShipping: z.boolean().optional(),
  returnsAccepted: z.boolean().optional(),
  zip: z.string().regex(/^\d{5}$/).optional(),
});

export const validateResearchSearch = (req: Request, res: Response, next: NextFunction) => {
  const parsed = researchSearchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid research parameters',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }
  req.body = parsed.data;
  next();
};

/** v1|<legacy>|<variation> or the bare legacy number from an ebay.com/itm URL. */
export const validateItemId = (req: Request, res: Response, next: NextFunction) => {
  const id = String(req.params.id ?? '');
  if (!/^(v1\|\d{9,15}\|\d+|\d{9,15})$/.test(id)) {
    res.status(400).json({ error: 'Invalid item id' });
    return;
  }
  next();
};
