import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Register validation schema
const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Login validation schema
const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

// Verify email validation schema
const verifySchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Forgot password validation schema
const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

// Validation middleware
export const validateRegister = (req: Request, res: Response, next: NextFunction) => {
  try {
    registerSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
    } else {
      res.status(400).json({ error: 'Invalid input data' });
    }
  }
};

export const validateLogin = (req: Request, res: Response, next: NextFunction) => {
  try {
    loginSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
    } else {
      res.status(400).json({ error: 'Invalid input data' });
    }
  }
};

export const validateVerify = (req: Request, res: Response, next: NextFunction) => {
  try {
    verifySchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
    } else {
      res.status(400).json({ error: 'Invalid input data' });
    }
  }
};

export const validateForgotPassword = (req: Request, res: Response, next: NextFunction) => {
  try {
    forgotPasswordSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
    } else {
      res.status(400).json({ error: 'Invalid input data' });
    }
  }
};
