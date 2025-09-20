import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/error.middleware';
import { Redis } from 'ioredis';
import { redisConfig } from './config/redis.config';
import { prisma } from './lib/prisma';
import { RateLimitService } from './services/ratelimit.service';
import ebayNotificationRoutes from './routes/ebay-notification.routes';
import monitorRoutes from './routes/monitor.routes';
import emailRoutes from './routes/email.routes';
import authRoutes from './routes/auth.routes'
import { EbayAuthService } from './services/ebay-auth.service';
import { EbayService } from './services/ebay.service';
import { CacheService } from './services/cache.service';
import { NotificationService } from './services/notification.service';
import { EmailService } from './services/email.service';
import { ComparisonService } from './services/comparison.service';
import { MonitorWorker } from './workers/monitor.worker';

const app = express();
const port = process.env.PORT || 3000;

// Initialize Redis with Railway URL or local config
const redis = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        console.log(`Redis connection retry #${times} after ${delay}ms`);
        return delay;
      }
    })
  : new Redis({
      ...redisConfig,
      lazyConnect: true,
    });

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redis.on('connect', () => {
  console.log('Successfully connected to Redis');
});

redis.on('ready', () => {
  console.log('Redis connection is ready');
});

// Connect to Redis with retry logic
async function initializeRedis() {
  let retries = 5;
  const retryDelay = 5000;
  
  while (retries > 0) {
    try {
      await redis.connect();
      console.log('Redis connected successfully');
      return;
    } catch (error) {
      console.error(`Failed to connect to Redis (${retries} retries left):`, error);
      retries--;
      
      if (retries === 0) {
        console.error('Failed to connect to Redis after all retries');
        throw error;
      }
      
      console.log(`Waiting ${retryDelay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Initialize application
async function initialize() {
  try {
    // Connect to Redis
    await initializeRedis();
    
    // Test database connection
    console.log('Testing database connection...');
    await prisma.$connect();
    console.log('Database connected successfully');
    
    // Initialize services
    const rateLimitService = new RateLimitService(redis);
    const ebayAuthService = new EbayAuthService(redis);
    const ebayService = new EbayService(ebayAuthService);
    const cacheService = new CacheService(redis);
    const emailService = new EmailService();
    const notificationService = new NotificationService(rateLimitService, emailService);
    const comparisonService = new ComparisonService(notificationService, emailService);
    
    // Initialize worker, listening to the monitor queue for new jobs
    const monitorWorker = new MonitorWorker(
      ebayService,
      cacheService,
      comparisonService
    );
    
    // Configure CORS
    app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3001',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));
   
    app.use(express.json());
   
    // Routes
    app.use('/api/ebay-notifications', ebayNotificationRoutes);
    app.use('/api/monitors', monitorRoutes);
    app.use('/api/emails', emailRoutes);
    app.use('/api/auth', authRoutes);
   
    // Health check
    app.get('/health', async (req, res) => {
      try {
        // Check Redis
        await redis.ping();
        
        // Check Database
        await prisma.$queryRaw`SELECT 1`;
        
        res.json({ 
          status: 'healthy',
          services: {
            redis: 'connected',
            database: 'connected'
          }
        });
      } catch (error) {
        res.status(503).json({ 
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
    
    app.get('/test', async (req, res) => {
      try {
        // Test database connection
        const userCount = await prisma.user.count();
        res.json({
          status: 'success',
          message: 'Database connection successful',
          userCount
        });
      } catch (error) {
        console.error('Database connection error:', error);
        res.status(500).json({
          status: 'error',
          message: 'Database connection failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
   
    app.use(errorHandler);
   
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
});

initialize().catch((error) => {
  console.error('Application initialization failed:', error);
  process.exit(1);
});