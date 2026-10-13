import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

/**
 * Periodic removal of rows that have outlived their expiry.
 *
 * Better Auth writes Session and Verification rows but never prunes them.
 * Production carries 41 expired sessions against 2 live ones, and every one of
 * them is also an entry in three Session indexes. Nothing reads an expired row
 * -- both tables are queried with an `expiresAt > now()` guard -- so they are
 * pure storage and index-maintenance cost that grows with every login.
 */

/** Grace period before an expired row is removed, so nothing races a check. */
const GRACE_MS = 24 * 60 * 60 * 1000;

/** How often the sweep runs while the process is up. */
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class CleanupService {
  /**
   * Delete expired sessions and verification tokens.
   * Never throws: this is housekeeping and must not affect request handling.
   */
  async purgeExpiredRows(): Promise<{ sessions: number; verifications: number }> {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const removed = { sessions: 0, verifications: 0 };

    try {
      const { count } = await prisma.session.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });
      removed.sessions = count;
    } catch (error) {
      logger.error('cleanup.sessions_failed', { error });
    }

    try {
      const { count } = await prisma.verification.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });
      removed.verifications = count;
    } catch (error) {
      logger.error('cleanup.verifications_failed', { error });
    }

    if (removed.sessions || removed.verifications) {
      logger.info('cleanup.purged', removed);
    }

    return removed;
  }

  /**
   * Run the sweep now, then daily. Returns the timer so shutdown can clear it.
   * unref() keeps the interval from holding the process open on its own.
   */
  start(): NodeJS.Timeout {
    void this.purgeExpiredRows();

    const timer = setInterval(() => {
      void this.purgeExpiredRows();
    }, CLEANUP_INTERVAL_MS);

    timer.unref();
    return timer;
  }
}
