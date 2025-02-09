import { Request, Response, NextFunction } from 'express';

// TODO: Implement proper authentication
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Placeholder: Set a dummy user ID for development
  req.user = { id: 'test-user-id' };
  next();
};