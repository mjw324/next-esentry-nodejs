import EbayAuthToken from 'ebay-oauth-nodejs-client';
import { Redis } from 'ioredis';
import { ebayConfig } from '../config/ebay.config';

export class EbayAuthService {
  private readonly TOKEN_KEY = 'ebay:access_token';
  private readonly TOKEN_EXPIRY_KEY = 'ebay:token_expiry';
  private readonly ENV_KEY = 'ebay:current_environment';
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
      
      // Check for environment changes and clear cache if needed
      this.checkEnvironmentChange().catch(error => {
        console.error('Error checking environment change:', error);
      });
    } catch (error) {
      console.error('Failed to initialize eBay Auth client:', error);
      throw error;
    }
  }

  /**
   * Check if environment has changed and clear cache if needed
   */
  private async checkEnvironmentChange(): Promise<void> {
    try {
      const cachedEnv = await this.redis.get(this.ENV_KEY);
      const currentEnv = ebayConfig.environment;
      
      if (cachedEnv && cachedEnv !== currentEnv) {
        console.log(`⚠️ Environment changed from ${cachedEnv} to ${currentEnv}`);
        console.log('Clearing all eBay caches to prevent token mismatch...');
        await this.clearAllEbayCache();
      }
      
      await this.redis.set(this.ENV_KEY, currentEnv);
    } catch (error) {
      console.error('Error checking environment change:', error);
    }
  }

  /**
   * Clear ALL eBay-related cache (both environments)
   */
  private async clearAllEbayCache(): Promise<void> {
    const keysToDelete = [
      'ebay:access_token',
      'ebay:token_expiry'
    ];
    
    await this.redis.del(...keysToDelete);
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