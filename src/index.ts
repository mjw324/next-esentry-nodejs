import express from 'express';
import cors from 'cors';
import monitorRoutes from './routes/monitor.routes';
import { errorHandler } from './middleware/error.middleware';
import { Redis } from 'ioredis';
import { redisConfig } from './config/redis.config';
import { prisma } from './lib/prisma';
import { MonitorQueue } from './queues/monitor.queue';
import { RateLimitService } from './services/ratelimit.service';
import { MonitorService } from './services/monitor.service';
import { MonitorController } from './controllers/monitor.controller';
import emailRoutes from './routes/email.routes';
import { EbayAuthService } from './services/ebay-auth.service';
import { EbayService } from './services/ebay.service';
import { CacheService } from './services/cache.service';
import { NotificationService } from './services/notification.service';
import { EmailService } from './services/email.service';
import { ComparisonService } from './services/comparison.service';
import { MonitorWorker } from './workers/monitor.worker';
import ebayNotificationRoutes from './routes/ebay-notification.routes';
import { VerificationService } from './services/verification.service';

const app = express();
const port = process.env.PORT || 3000;

// Initialize services
const redis = new Redis({
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

// Connect to Redis
async function initializeRedis() {
  try {
    await redis.connect();
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    process.exit(1);
  }
}

// Initialize application
async function initialize() {
  try {
    await initializeRedis();
    const monitorQueue = new MonitorQueue(redis);
    const rateLimitService = new RateLimitService(redis);
    const monitorService = new MonitorService(rateLimitService, monitorQueue);    
    const ebayAuthService = new EbayAuthService(redis);
    const ebayService = new EbayService(ebayAuthService);
    const cacheService = new CacheService(redis);
    const emailService = new EmailService();
    const notificationService = new NotificationService(rateLimitService);
    const comparisonService = new ComparisonService(notificationService, emailService);
    const verificationService = new VerificationService();
    const monitorController = new MonitorController(monitorService, emailService, verificationService);

    // Initialize workers
    const monitorWorker = new MonitorWorker(
      ebayService,
      cacheService,
      comparisonService,
      redis
    );
    
    app.use(cors());
    app.use(express.json());
    
    // Routes
    app.use('/api/ebay-notifications', ebayNotificationRoutes);
    app.use('/api/monitors', monitorRoutes);
    app.use('/api/email', emailRoutes);
    
    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });
    app.get('/test', async (req, res) => {
      try {
        // Test database connection
        const userCount = await prisma.user.count()
        res.json({ 
          status: 'success',
          message: 'Database connection successful',
          userCount 
        })
      } catch (error) {
        console.error('Database connection error:', error)
        res.status(500).json({ 
          status: 'error',
          message: 'Database connection failed' 
        })
      }
    })
    
    app.use(errorHandler);
    
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

initialize().catch((error) => {
  console.error('Application initialization failed:', error);
  process.exit(1);
});