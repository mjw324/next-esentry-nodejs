import { Request, Response, NextFunction } from 'express';
import { RateLimitError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log the shape of the failure, not the whole error object: Prisma errors
  // embed the failing query and its parameters.
  logger.error('request.failed', {
    method: req.method,
    path: req.path,
    name: error.name,
    message: error.message,
  });

  // Handle RateLimitError
  if (error instanceof RateLimitError) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: error.message
    });
    return;
  }

  // Handle ValidationError
  if (error instanceof ValidationError) {
    res.status(400).json({
      error: 'Validation error',
      message: error.message
    });
    return;
  }

  // Handle other known errors
  if (error.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation error',
      message: error.message
    });
    return;
  }

  // Default to 500 for unknown errors
  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
};
