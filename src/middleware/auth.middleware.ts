import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

/**
 * Authenticates a request by its better-auth session (audit F-1).
 *
 * The frontend's server routes forward the signed-in user's session token as
 * `Authorization: Bearer <token>`. The token is looked up in the Session table
 * both apps share, so the backend identifies the user itself instead of
 * trusting a user ID supplied by the caller. A signed-out or expired session
 * stops working here immediately.
 *
 * The old `user-id` header, which anyone could send straight to this API, is
 * accepted only when AUTH_ALLOW_LEGACY_USER_ID=true and the request carries no
 * Authorization header. That exists for rollback during the rollout; leave it
 * unset in production.
 */
const allowLegacyUserId = process.env.AUTH_ALLOW_LEGACY_USER_ID === 'true';

if (allowLegacyUserId) {
  logger.warn('auth.legacy_user_id_enabled');
}

/**
 * Personal access tokens, for scripts that act as one user without a browser
 * session (the owner's shopping-research workspace calls /api/research with
 * one). Configured as PERSONAL_ACCESS_TOKENS="<userId>:<sha256 hex>[,...]", so
 * only hashes live in the environment; rotating a token is an env change.
 * Tokens carry the `esp_` prefix and never reach the Session table.
 */
const PERSONAL_TOKEN_PREFIX = 'esp_';

interface PersonalToken {
  userId: string;
  hash: Buffer;
}

function parsePersonalTokens(raw: string | undefined): PersonalToken[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [userId, hex] = entry.split(':');
      if (!userId || !/^[0-9a-f]{64}$/i.test(hex ?? '')) {
        logger.warn('auth.personal_token_malformed');
        return [];
      }
      return [{ userId, hash: Buffer.from(hex, 'hex') }];
    });
}

const personalTokens = parsePersonalTokens(process.env.PERSONAL_ACCESS_TOKENS);

function personalTokenUser(token: string): string | null {
  const digest = createHash('sha256').update(token).digest();
  const match = personalTokens.find((t) => timingSafeEqual(t.hash, digest));
  return match?.userId ?? null;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.headers.authorization) {
      const token = bearerToken(req);

      if (token?.startsWith(PERSONAL_TOKEN_PREFIX)) {
        const userId = personalTokenUser(token);
        if (!userId) {
          res.status(401).json({ error: 'Unauthorized - Invalid access token' });
          return;
        }
        req.user = { id: userId };
        next();
        return;
      }

      const session = token
        ? await prisma.session.findUnique({
            where: { token },
            select: { userId: true, expiresAt: true },
          })
        : null;

      if (!session || session.expiresAt <= new Date()) {
        res.status(401).json({ error: 'Unauthorized - Invalid or expired session' });
        return;
      }

      req.user = { id: session.userId };
      next();
      return;
    }

    const legacyUserId = req.headers['user-id'];
    if (allowLegacyUserId && typeof legacyUserId === 'string' && legacyUserId) {
      logger.warn('auth.legacy_user_id_used', { path: req.path });
      req.user = { id: legacyUserId };
      next();
      return;
    }

    res.status(401).json({ error: 'Unauthorized - Missing session' });
  } catch (error) {
    // A failed lookup is a server fault, not a bad credential. Log only the
    // error's name: a Prisma error message can quote the query, token included.
    logger.error('auth.middleware_failed', {
      name: error instanceof Error ? error.name : typeof error,
    });
    res.status(503).json({ error: 'Authentication unavailable' });
  }
};
