import { Request, Response, NextFunction } from 'express';
import { emailSetupSchema, otpSchema } from '../../types/email.types';

export const validateEmailSetup = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    emailSetupSchema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid email address' });
  }
};

export const validateOtpBody = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    otpSchema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid OTP format' });
  }
};
