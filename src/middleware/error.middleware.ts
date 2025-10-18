import { Request, Response, NextFunction } from 'express';
import { RateLimitError, ValidationError } from '../utils/errors';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(error);

  // Handle RateLimitError
  if (error instanceof RateLimitError) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: error.message
    });
  }

  // Handle ValidationError
  if (error instanceof ValidationError) {
    return res.status(400).json({
      error: 'Validation error',
      message: error.message
    });
  }

  // Handle other known errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      message: error.message
    });
  }

  // Default to 500 for unknown errors
  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
};
