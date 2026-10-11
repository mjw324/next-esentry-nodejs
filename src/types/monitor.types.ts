import { z } from 'zod';

export const createMonitorSchema = z.object({
  keywords: z.array(z.string()).min(1),
  excludedKeywords: z.array(z.string()).optional(),
  // nullish: API clients send null for "no price"; the column is nullable and
  // PATCH already stores null as "no bound". Same as the insights schema (R-8).
  minPrice: z.number().min(0).nullish(),
  maxPrice: z.number().min(0).nullish(),
  conditions: z.array(z.enum(['NEW', 'USED'])).optional(),
  sellers: z.array(z.string()).optional(),
  interval: z.number().min(60000).optional(), // Minimum 1 minute in milliseconds
  useLoginEmail: z.boolean().optional(),
  customEmail: z.string().email().optional()
});

export type CreateMonitorDTO = z.infer<typeof createMonitorSchema>;

export interface MonitorResponse {
  id: string;
  userId: string;
  keywords: string[];
  excludedKeywords: string[];
  minPrice?: number;
  maxPrice?: number;
  conditions: string[];
  sellers: string[];
  status: 'active' | 'inactive';
  interval: number;
  nextCheckAt?: Date;
  lastCheckTime?: Date;
  lastResultCount: number;
  /**
   * How often the monitor is actually checked: `interval`, or longer while it
   * is backed off for returning nothing (R-4).
   */
  effectiveIntervalMs?: number;
  /** Present while the monitor is backed off. */
  backoff?: {
    emptyStreak: number;
    factor: number;
    nextCheckAfter: Date;
  };
}