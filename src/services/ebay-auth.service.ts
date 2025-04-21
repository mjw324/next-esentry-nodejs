import EbayAuthToken from 'ebay-oauth-nodejs-client';
import { Redis } from 'ioredis';
import { ebayConfig } from '../config/ebay.config';

export class EbayAuthService {
  private readonly TOKEN_KEY = 'ebay:access_token';
  private readonly TOKEN_EXPIRY_KEY = 'ebay:token_expiry';
  private ebayAuth: EbayAuthToken;

  constructor(private redis: Redis) {
    // Validate credentials
    if (!ebayConfig.credentials.clientId) {
      throw new Error('EBAY_CLIENT_ID is not configured');
    }
    if (!ebayConfig.credentials.clientSecret) {
      throw new Error('EBAY_CLIENT_SECRET is not configured');
    }

    try {
      this.ebayAuth = new EbayAuthToken({
        clientId: ebayConfig.credentials.clientId,
        clientSecret: ebayConfig.credentials.clientSecret,
        redirectUri: ebayConfig.credentials.redirectUri,
        env: ebayConfig.environment
      });
    } catch (error) {
      console.error('Failed to initialize eBay Auth client:', error);
      throw error;
    }
  }

  async getAccessToken(): Promise<string> {
    try {
      // TODO: Use cache.service.ts for this operation instead of directly accessing redis
      // Try to get cached token
      const [cachedToken, cachedExpiry] = await Promise.all([
        this.redis.get(this.TOKEN_KEY),
        this.redis.get(this.TOKEN_EXPIRY_KEY),
      ]);

      // Check if token exists and is not close to expiring
      if (cachedToken && cachedExpiry) {
        const expiryTime = parseInt(cachedExpiry);
        if (Date.now() < expiryTime - (ebayConfig.tokenExpiryBuffer * 1000)) {
          return cachedToken;
        }
      }

      // Get new token
      const token = await this.fetchNewToken();
      return token;
    } catch (error) {
      console.error('Error getting eBay access token:', error);
      throw new Error('Failed to authenticate with eBay');
    }
  }

  private async fetchNewToken(): Promise<string> {
    try {
      console.log('Fetching new token with environment:', ebayConfig.environment);
      const response = await this.ebayAuth.getApplicationToken(ebayConfig.environment);
      console.log('Raw token response:', response);

      const tokenData = JSON.parse(response);

      const { access_token, expires_in } = tokenData;

      // Cache the token
      const expiryTime = Date.now() + (expires_in * 1000);
      // TODO: Use cache.service.ts for this operation instead of directly accessing redis
      await Promise.all([
        this.redis.set(this.TOKEN_KEY, access_token),
        this.redis.set(this.TOKEN_EXPIRY_KEY, expiryTime.toString()),
        this.redis.expire(this.TOKEN_KEY, expires_in),
        this.redis.expire(this.TOKEN_EXPIRY_KEY, expires_in),
      ]);

      return access_token;
    } catch (error) {
      console.error('Error fetching new eBay token:', error);
      throw new Error('Failed to obtain eBay authentication token');
    }
  }
}