import { z } from 'zod';

export const emailSetupSchema = z.object({
    email: z.string().email(),
});

export const otpSchema = z.object({
    otp: z.string().min(6).max(6),
});
