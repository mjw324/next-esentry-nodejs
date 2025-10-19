import { createHmac, timingSafeEqual } from 'crypto';
import { authConfig } from '../config/auth.config';

export interface UnsubscribeToken {
  monitorId: string;
  email: string;
  timestamp: number;
}

export class UnsubscribeTokenService {
  private readonly secret: string;
  private readonly expirationTime: number = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor() {
    this.secret = authConfig.jwt.secret;
  }

  /**
   * Generate a secure unsubscribe token
   */
  generateToken(monitorId: string, email: string): string {
    const timestamp = Date.now();
    const payload = `${monitorId}:${email}:${timestamp}`;
    const signature = createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url');

    return `${payload}.${signature}`;
  }

  /**
   * Verify and decode an unsubscribe token
   */
  verifyToken(token: string): UnsubscribeToken | null {
    try {
      const [payload, providedSignature] = token.split('.');
      if (!payload || !providedSignature) {
        return null;
      }

      // Verify signature
      const expectedSignature = createHmac('sha256', this.secret)
        .update(payload)
        .digest('base64url');

      // Use timing-safe comparison to prevent timing attacks
      const signaturesMatch = timingSafeEqual(
        Buffer.from(providedSignature, 'base64url'),
        Buffer.from(expectedSignature, 'base64url')
      );

      if (!signaturesMatch) {
        return null;
      }

      // Parse payload
      const [monitorId, email, timestampStr] = payload.split(':');
      if (!monitorId || !email || !timestampStr) {
        return null;
      }

      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp)) {
        return null;
      }

      // Check expiration
      if (Date.now() - timestamp > this.expirationTime) {
        return null;
      }

      return {
        monitorId,
        email,
        timestamp
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate unsubscribe URL
   */
  generateUnsubscribeUrl(monitorId: string, email: string): string {
    const token = this.generateToken(monitorId, email);
    const baseUrl = process.env.FRONTEND_URL || process.env.API_URL || 'http://localhost:3000';
    return `${baseUrl}/api/unsubscribe/${token}`;
  }
}