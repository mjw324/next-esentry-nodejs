import { createHash } from 'crypto';
import { EbayNotification } from '../types/ebay.types';

export class EbayNotificationService {
    constructor(
        private verificationToken: string,
        private endpoint: string
    ) {}

    validateChallenge(challengeCode: string): string {
        const hash = createHash('sha256');

        hash.update(Buffer.from(challengeCode));
        hash.update(Buffer.from(this.verificationToken));
        hash.update(Buffer.from(this.endpoint));

        return hash.digest('hex');
    }

    async processAccountDeletion(notification: EbayNotification): Promise<void> {
        // Log the notification for audit purposes
        console.log('Received eBay account deletion notification:', {
            notificationId: notification.notification.notificationId,
            username: notification.notification.data.username,
            eventDate: notification.notification.eventDate
        });

        // Since we don't store user data, we just acknowledge the notification
    }
}
