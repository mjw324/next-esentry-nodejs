import { Request, Response, NextFunction } from 'express';

// TODO: Consider JWT validation with Auth.js
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get user ID from header (primary method)
    const userIdFromHeader = req.headers['user-id'];

    // Get user ID from body (fallback method)
    const userIdFromBody = req.body?.userId;

    // Get the user ID from either source
    const userId = userIdFromHeader || userIdFromBody;

    // Validate that we have a user ID
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized - Missing user ID' });
      return; // Return without a value (void)
    }

    // Set the user object on the request
    req.user = { 
      id: typeof userId === 'string' ? userId : String(userId) 
    };

    // For debugging during development
    console.log(`Request authenticated for user: ${req.user.id}`);

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
    // No return statement here
  }
};