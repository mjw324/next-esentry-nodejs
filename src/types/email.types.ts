import { z } from 'zod';

export const emailSetupSchema = z.object({
    email: z.string().email(),
});