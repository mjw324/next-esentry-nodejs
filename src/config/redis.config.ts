import { RedisOptions } from 'ioredis';

// Parse Redis URL if available (Railway provides this)
function parseRedisUrl(url: string): RedisOptions {
  try {
    const parsed = new URL(url);
    
    // Handle Railway's internal Redis URL format
    // Railway uses redis://:password@servicename.railway.internal:port
    const config: RedisOptions = {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379'),
      // Railway puts password in the password field of the URL
      password: parsed.password || undefined,
      // Sometimes username is 'default' or empty for Redis
      username: parsed.username || undefined,
      // Database number from path (e.g., /0)
      db: parsed.pathname ? parseInt(parsed.pathname.slice(1) || '0') : 0,
    };
    
    console.log('Parsed Redis config:', {
      host: config.host,
      port: config.port,
      hasPassword: !!config.password,
      db: config.db
    });
    
    return config;
  } catch (error) {
    console.error('Failed to parse Redis URL:', error);
    throw error;
  }
}

// Base configuration for Redis
const baseConfig: Partial<RedisOptions> = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  readOnly: false,
  // Add connection timeout
  connectTimeout: 10000,
  // Enable family 4 (IPv4) to avoid IPv6 issues
  family: 4,
  reconnectOnError: (err: Error) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      console.warn('Redis READONLY error detected, attempting reconnection');
      return true;
    }
    return false;
  },
  retryStrategy: (times: number) => {
    const maxDelay = 5000;
    const delay = Math.min(times * 100, maxDelay);
    console.log(`Redis retry attempt ${times}, waiting ${delay}ms`);
    return delay;
  }
};

// Main Redis configuration
export const redisConfig: RedisOptions = (() => {
  if (process.env.REDIS_URL) {
    console.log('Using REDIS_URL for connection');
    return {
      ...parseRedisUrl(process.env.REDIS_URL),
      ...baseConfig
    };
  } else {
    console.log('Using individual Redis config variables');
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      ...baseConfig
    };
  }
})();

// BullMQ Redis connection configuration
export const bullMQRedisConnection = (() => {
  const bullConfig = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    readOnly: false,
    family: 4,
    connectTimeout: 10000,
    reconnectOnError: (err: Error) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        console.warn('BullMQ Redis READONLY error detected, attempting reconnection');
        return true;
      }
      return false;
    },
    retryStrategy: (times: number) => {
      const maxDelay = 5000;
      const delay = Math.min(times * 100, maxDelay);
      return delay;
    }
  };
  
  if (process.env.REDIS_URL) {
    return {
      ...parseRedisUrl(process.env.REDIS_URL),
      ...bullConfig
    };
  } else {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      ...bullConfig
    };
  }
})();