import { Express } from 'express-serve-static-core';

declare global {
    namespace Express {
      interface Request {
        user: {
          id: string;
          /** Authenticated by a personal access token (`esp_`), not a browser session. */
          personalToken?: boolean;
        };
      }
    }
  }