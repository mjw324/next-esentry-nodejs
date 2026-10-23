// Must stay first: loads .env before any module reads process.env.
// Existing variables (e.g. Railway's) are never overridden.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/error.middleware';
import { Redis } from 'ioredis';
import { redisConfig } from './config/redis.config';
import { prisma } from './lib/prisma';
import ebayNotificationRoutes from './routes/ebay-notification.routes';
import { createMonitorRouter } from './routes/monitor.routes';
import { createInsightsRouter } from './routes/insights.routes';
import { createResearchRouter } from './routes/research.routes';
import { createEmailRouter } from './routes/email.routes';
import { createAuthRouter } from './routes/auth.routes';
import { MonitorWorker } from './workers/monitor.worker';
import { MonitorController } from './controllers/monitor.controller';
import { createContainer } from './container';

const app = express();
const port = process.env.PORT || 3000;

// Log environment for debugging
console.log('=== Starting Application ===');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', port);
console.log('Redis URL provided:', !!process.env.REDIS_URL);
console.log('Database URL provided:', !!process.env.DATABASE_URL);

// Initialize Redis with better error handling
let redis: Redis;

if (process.env.REDIS_URL) {
  console.log('Initializing Redis with REDIS_URL');
  // When using REDIS_URL, ioredis can parse it directly
  redis = new Redis(process.env.REDIS_URL + '?family=0', {
    lazyConnect: true,
    enableAutoPipelining: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10000,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 100, 5000);
      console.log(`Redis retry attempt ${times}, waiting ${delay}ms`);
      if (times > 20) {
        console.error('Redis connection failed after 20 attempts');
        return null;
      }
      return delay;
    },
  });
} else {
  console.log('Initializing Redis with individual config');
  redis = new Redis({
    ...redisConfig,
    lazyConnect: true,
  });
}

// Better error handling for Redis
redis.on('error', (error) => {
  console.error('Redis error event:', error.message);
  if (error.message.includes('ENOTFOUND')) {
    console.error(
      'Redis hostname not found. Check if Redis service is properly linked in Railway.'
    );
  }
});

redis.on('connect', () => {
  console.log('Redis: Connection established');
});

redis.on('ready', () => {
  console.log('Redis: Ready for commands');
});

redis.on('reconnecting', (delay: number) => {
  console.log(`Redis: Reconnecting in ${delay}ms`);
});

redis.on('close', () => {
  console.log('Redis: Connection closed');
});

// Connect to Redis with better retry logic
async function initializeRedis() {
  const maxRetries = 10;
  const retryDelay = 3000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Redis connection attempt ${attempt}/${maxRetries}`);
      await redis.connect();

      // Test the connection
      const pong = await redis.ping();
      if (pong === 'PONG') {
        console.log('Redis connection verified with PING/PONG');
        return;
      }
    } catch (error: any) {
      console.error(
        `Redis connection attempt ${attempt} failed:`,
        error.message
      );

      if (error.message.includes('ENOTFOUND')) {
        console.error('Cannot resolve Redis hostname. Checking environment...');
        console.error('REDIS_URL:', process.env.REDIS_URL ? 'Set' : 'Not set');

        if (attempt === maxRetries) {
          throw new Error(
            'Redis service not found. Ensure Redis service is created and linked in Railway.'
          );
        }
      }

      if (attempt < maxRetries) {
        console.log(`Waiting ${retryDelay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } else {
        throw error;
      }
    }
  }
}

// Initialize application with better error messages
async function initialize() {
  try {
    // First check if we have required environment variables
    if (!process.env.DATABASE_URL && !process.env.POSTGRES_HOST) {
      throw new Error(
        'DATABASE_URL or POSTGRES_HOST must be set. Ensure PostgreSQL service is linked in Railway.'
      );
    }

    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
      console.warn(
        'WARNING: Neither REDIS_URL nor REDIS_HOST is set. Redis features will be disabled.'
      );
      // You might want to run in a degraded mode without Redis
      // Or throw an error if Redis is required
      throw new Error(
        'REDIS_URL must be set. Ensure Redis service is linked in Railway.'
      );
    }

    // Connect to Redis
    console.log('Connecting to Redis...');
    await initializeRedis();

    // Test database connection
    console.log('Connecting to Database...');
    await prisma.$connect();
    const dbTest = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('Database connection verified');

    // Build the service graph once and share it with every route module.
    const container = createContainer(redis);
    const { monitorService, ebayService, cacheService, comparisonService,
            emailService, verificationService } = container;

    // Initialize worker
    const monitorWorker = new MonitorWorker(
      ebayService,
      cacheService,
      comparisonService
    );

    console.log('All services initialized');

    // Don't advertise the framework. The domain is scanned constantly
    // (~2,300 probes/week in production), so this is a free fingerprint.
    app.disable('x-powered-by');

    // No client issues conditional GETs against this API, so hashing every
    // JSON response body to produce an ETag is pure overhead.
    app.set('etag', false);

    // Configure CORS
    app.use(
      cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3001',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      })
    );

    // No legitimate request approaches this; the default is 100kb.
    app.use(express.json({ limit: '32kb' }));

    // Routes
    app.use('/api/ebay-notifications', ebayNotificationRoutes);
    app.use('/api/monitors', createMonitorRouter(container));
    app.use('/api/insights', createInsightsRouter(container));
    app.use('/api/research', createResearchRouter(container));
    app.use('/api/emails', createEmailRouter(container));
    app.use('/api/auth', createAuthRouter(container));

    // Unsubscribe route (no authentication required)
    const unsubscribeController = new MonitorController(
      monitorService,
      emailService,
      verificationService
    );
    app.get(
      '/api/unsubscribe/:token',
      unsubscribeController.unsubscribeFromMonitor.bind(unsubscribeController)
    );

    // Liveness: is the process up and serving? No I/O, so a brief Redis or
    // database blip cannot get the container restarted -- which, since the
    // health check gates the deploy, used to be an expensive false positive.
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Readiness: are the dependencies actually reachable? For dashboards and
    // humans, not for the platform's restart decision.
    app.get('/ready', async (req, res) => {
      const health: any = {
        status: 'checking',
        timestamp: new Date().toISOString(),
        services: {},
      };

      try {
        // Check Redis
        try {
          const redisPing = await redis.ping();
          health.services.redis =
            redisPing === 'PONG' ? 'healthy' : 'unhealthy';
        } catch (error) {
          health.services.redis = 'error';
        }

        // Check Database
        try {
          await prisma.$queryRaw`SELECT 1`;
          health.services.database = 'healthy';
        } catch (error) {
          health.services.database = 'error';
        }

        // Overall status
        const allHealthy = Object.values(health.services).every(
          (s) => s === 'healthy'
        );
        health.status = allHealthy ? 'healthy' : 'degraded';

        res.status(allHealthy ? 200 : 503).json(health);
      } catch (error) {
        health.status = 'unhealthy';
        health.error = error instanceof Error ? error.message : 'Unknown error';
        res.status(503).json(health);
      }
    });

    // Detailed test endpoint
    app.get('/test', async (req, res) => {
      try {
        const results: any = {
          environment: {
            NODE_ENV: process.env.NODE_ENV,
            hasRedisUrl: !!process.env.REDIS_URL,
            hasDatabaseUrl: !!process.env.DATABASE_URL,
          },
          redis: {},
          database: {},
        };

        // Test Redis
        try {
          await redis.ping();
          results.redis.status = 'connected';
          results.redis.info = {
            host: redis.options.host,
            port: redis.options.port,
          };
        } catch (error: any) {
          results.redis.status = 'error';
          results.redis.error = error.message;
        }

        // Test Database
        try {
          const userCount = await prisma.user.count();
          results.database.status = 'connected';
          results.database.userCount = userCount;
        } catch (error: any) {
          results.database.status = 'error';
          results.database.error = error.message;
        }

        res.json(results);
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    app.use(errorHandler);

    // Express 5 calls this back with the error when the bind fails (e.g.
    // EADDRINUSE) instead of throwing. Ignoring it left a process with no HTTP
    // server running the worker and the boot reconciliation (R-10).
    app.listen(port, (error?: Error) => {
      if (error) {
        console.error(`Failed to listen on port ${port}:`, error.message);
        process.exit(1);
      }

      console.log('=== Server Started ===');
      console.log(`Listening on port ${port}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
      console.log(`Health check: http://localhost:${port}/health`);
      console.log('=====================');

      // Reconcile schedulers after the server is accepting traffic. This work
      // scales with the number of active monitors, and blocking on it meant
      // the health check failed for its whole duration. The worker is already
      // consuming the queue by this point, so nothing is missed.
      monitorService.initializeActiveMonitors().catch((error) => {
        console.error('Monitor initialization failed:', error);
      });

      // Daily sweep of expired sessions and verification tokens.
      container.cleanupService.start();

      // Hourly: queue tracked auctions about to end, record the ones that sold.
      container.soldTrackerService.start();

      // Finished-job sweep and events-stream trim (R-12); boot does one too.
      container.monitorQueue.startPeriodicMaintenance();
    });
  } catch (error) {
    console.error('=== Initialization Failed ===');
    console.error('Error:', error instanceof Error ? error.message : error);
    console.error(
      'Stack:',
      error instanceof Error ? error.stack : 'No stack trace'
    );
    console.error('===========================');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  try {
    await redis.quit();
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  try {
    await redis.quit();
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

// Start the application
console.log('=== Initializing Application ===');
initialize().catch((error) => {
  console.error('Fatal initialization error:', error);
  process.exit(1);
});
