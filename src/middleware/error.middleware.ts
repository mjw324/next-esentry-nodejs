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

  // Client errors raised by Express's own middleware carry their status:
  // body-parser sets 413 for a body over express.json's limit and 400 for
  // malformed JSON. They were all answered (and logged) as 500s (R-14).
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({
      error: status === 413 ? 'Payload too large' : 'Bad request',
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
