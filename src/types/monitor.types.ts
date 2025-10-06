import { z } from 'zod';

export const createMonitorSchema = z.object({
  keywords: z.array(z.string()).min(1),
  excludedKeywords: z.array(z.string()).optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
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
}