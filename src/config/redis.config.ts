import { RedisOptions } from 'ioredis';

export const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  readOnly: false,
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      // Log the error before reconnecting
      console.warn('Redis READONLY error detected, attempting reconnection');
      return true;
    }
    return false;
  },
  retryStrategy: (times) => {
    // Exponential backoff with a maximum wait of 5 seconds
    return Math.min(Math.exp(times), 5000);
  }
};

export const bullMQRedisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  readOnly: false,
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      console.warn('BullMQ Redis READONLY error detected, attempting reconnection');
      return true;
    }
    return false;
  },
  retryStrategy: (times) => {
    // Exponential backoff with a maximum wait of 5 seconds
    return Math.min(Math.exp(times), 5000);
  }
};
