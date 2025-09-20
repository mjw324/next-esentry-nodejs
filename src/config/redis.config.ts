import { RedisOptions } from 'ioredis';

// Parse Redis URL if available (Railway provides this)
function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379'),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    db: parseInt(parsed.pathname?.slice(1) || '0'),
  };
}

// Base configuration for Redis
const baseConfig: Partial<RedisOptions> = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  readOnly: false,
  reconnectOnError: (err: Error) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      console.warn('Redis READONLY error detected, attempting reconnection');
      return true;
    }
    return false;
  },
  retryStrategy: (times: number) => {
    // Exponential backoff with a maximum wait of 5 seconds
    return Math.min(Math.exp(times), 5000);
  }
};

// Main Redis configuration
export const redisConfig: RedisOptions = process.env.REDIS_URL
  ? {
      ...parseRedisUrl(process.env.REDIS_URL),
      ...baseConfig
    }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      ...baseConfig
    };

// BullMQ Redis connection configuration
export const bullMQRedisConnection = process.env.REDIS_URL
  ? {
      ...parseRedisUrl(process.env.REDIS_URL),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      readOnly: false,
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          console.warn('BullMQ Redis READONLY error detected, attempting reconnection');
          return true;
        }
        return false;
      },
      retryStrategy: (times: number) => {
        return Math.min(Math.exp(times), 5000);
      }
    }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      readOnly: false,
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          console.warn('BullMQ Redis READONLY error detected, attempting reconnection');
          return true;
        }
        return false;
      },
      retryStrategy: (times: number) => {
        return Math.min(Math.exp(times), 5000);
      }
    };