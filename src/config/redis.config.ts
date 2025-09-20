import { RedisOptions } from 'ioredis';
import { QueueOptions } from 'bullmq';

// Parse Redis URL from environment variable
function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379'),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    db: parsed.pathname ? parseInt(parsed.pathname.slice(1) || '0') : 0,
  };
}

// Base Redis configuration
const baseConfig: RedisOptions = {
  family: 0, // Enable dual-stack lookup for both IPv4 and IPv6
  maxRetriesPerRequest: null,
  connectTimeout: 10000,
  enableReadyCheck: true,
  reconnectOnError: (err: Error) => err.message.includes('READONLY'),
  retryStrategy: (times: number) => Math.min(times * 100, 5000),
};

// Redis configuration based on environment variable (REDIS_URL or custom config)
export const redisConfig: RedisOptions = process.env.REDIS_URL
  ? {
      ...parseRedisUrl(process.env.REDIS_URL),
      ...baseConfig,
    }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      ...baseConfig,
    };

// BullMQ Redis connection configuration
export const bullMQRedisConnection: QueueOptions['connection'] = process.env.REDIS_URL
  ? {
      ...parseRedisUrl(process.env.REDIS_URL),
      family: 0, // Enable dual-stack lookup
    }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      family: 0, // Enable dual-stack lookup
    };
