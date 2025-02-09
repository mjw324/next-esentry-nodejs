import { Request, Response, NextFunction } from 'express';
import { emailSetupSchema } from '../../types/email.types';

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
