import { Router } from 'express';
import { MonitorController } from '../controllers/monitor.controller';
import { validateCreateMonitor } from '../middleware/validation/monitor.validation';
import { authMiddleware } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { Redis } from 'ioredis';
import { MonitorQueue } from '../queues/monitor.queue';
import { RateLimitService } from '../services/ratelimit.service';
import { MonitorService } from '../services/monitor.service';
import { EbayAuthService } from '../services/ebay-auth.service';
import { EbayService } from '../services/ebay.service';
import { CacheService } from '../services/cache.service';
import { CreateMonitorDTO } from '../types/monitor.types';

const router = Router();

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const ebayAuthService = new EbayAuthService(redis);
const ebayService = new EbayService(ebayAuthService);
const monitorQueue = new MonitorQueue(redis);
const rateLimitService = new RateLimitService(redis);
const monitorService = new MonitorService(prisma, rateLimitService, monitorQueue);
const monitorController = new MonitorController(monitorService);
const cacheService = new CacheService(redis);


router.post(
  '/',
  authMiddleware,
  validateCreateMonitor,
  monitorController.createMonitor.bind(monitorController)
);

router.get(
  '/test-ebay',
  async (req, res, next) => {
    try {
      const testParams = {
        keywords: ['iphone'],
        excludedKeywords: ['case', 'screen protector'],
        minPrice: 100,
        maxPrice: 1000,
        conditions: ['NEW'],
        sellers: [],
      };

      const results = await ebayService.searchItems(testParams);
      res.json(results);
    } catch (error) {
      next(error);
    }
  }
);

router.post('/test-monitor', async (req, res, next) => {
  try {
    console.log('🚀 Starting monitor test...');

    // 1. Create a test user if not exists
    console.log('👤 Creating/Finding test user...');
    const testUser = await prisma.user.upsert({
      where: { id: 'test-user-id' },
      update: {},
      create: {
        id: 'test-user-id',
        maxActiveMonitors: 10,
        maxApiCallsPerHour: 100,
        maxNotificationsPerDay: 50
      }
    });
    console.log('✅ Test user ready:', testUser.id);

    // 2. Create a test monitor
    console.log('📡 Creating test monitor...');
    const monitorData : CreateMonitorDTO = {
      keywords: ['iphone'],
      excludedKeywords: ['case', 'screen protector', 'broke', 'accessories', 'accessory'],
      minPrice: 400,
      maxPrice: 1000,
      conditions: [],
      sellers: []
    };

    const monitor = await monitorService.createMonitor(testUser.id, monitorData);
    console.log('Monitor created:', monitor);

    // 3. Activate the monitor
    console.log('Activating monitor...');
    await monitorService.activateMonitor(monitor.id);
    console.log('Monitor activated');

    // 4. Manually trigger a monitor check
    console.log('Triggering initial monitor check...');
    const job = await monitorQueue.addMonitorJob(monitor.id, 15000);
    console.log('Monitor job queued:');

    // 5. Wait for results
    console.log('Waiting for initial results...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

    // 6. Get monitor status
    const updatedMonitor = await prisma.monitor.findUnique({
      where: { id: monitor.id }
    });
    console.log('Monitor status:', updatedMonitor);

    // 7. Get cached results
    const results = await cacheService.getResults(monitor.id);
    console.log('Initial search results:', results);

    res.json({
      success: true,
      monitor: updatedMonitor,
      results: results,
      message: 'Monitor test completed successfully'
    });

  } catch (error) {
    console.error('Monitor test failed:', error);
    next(error);
  }
});

// @ts-ignore 
router.get('/test-monitor/:monitorId', async (req, res, next) => {
  try {
    const { monitorId } = req.params;
    console.log(`Checking monitor status for ID: ${monitorId}`);

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId }
    });

    if (!monitor) {
      console.log('Monitor not found');
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const results = await cacheService.getResults(monitorId);
    console.log('Current monitor status:', monitor);
    console.log('Current results:', results);

    res.json({
      monitor,
      results,
      message: 'Monitor status retrieved successfully'
    });

  } catch (error) {
    console.error('Error retrieving monitor status:', error);
    next(error);
  }
});

export default router;