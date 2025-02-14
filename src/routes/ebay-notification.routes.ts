import { Router } from 'express';
import { EbayNotificationController } from '../controllers/ebay-notification.controller';
import { EbayNotificationService } from '../services/ebay-notification.service';

const router = Router();

// Initialize service and controller
const notificationService = new EbayNotificationService(
    process.env.EBAY_VERIFICATION_TOKEN!,
    process.env.EBAY_NOTIFICATION_ENDPOINT!
);

const notificationController = new EbayNotificationController(notificationService);

// Routes
router.get('/', notificationController.handleChallenge);
router.post('/', notificationController.handleNotification);

export default router;
