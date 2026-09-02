import { NotificationService } from "./notification.service";
import { EmailService } from "./email.service";
import { EbayItem, TransformedEbayResults } from "../types/ebay.types";
import { logger } from "../utils/logger";

export class ComparisonService {
    constructor(
        private notificationService: NotificationService,
        private emailService: EmailService
    ) { }

    async compareResults(
        monitorId: string,
        userId: string,
        monitorTitle: string,
        oldResults: TransformedEbayResults,
        newResults: TransformedEbayResults
    ): Promise<void> {
        const newItems = this.findNewItems(oldResults.itemSummaries || [], newResults.itemSummaries || []);

        if (newItems.length > 0) {
            logger.info('monitor.new_items', { monitorId, count: newItems.length });
            await this.notificationService.sendNotification({
                userId,
                monitorId,
                monitorTitle,
                type: 'MONITOR_RESULTS',
                message: 'New items found for your monitor',
                data: { newItems }
            });
        }
    }

    private findNewItems(oldItems: EbayItem[], newItems: EbayItem[]): EbayItem[] {
        if (!oldItems || !newItems) {
            return newItems || [];
        }
        const oldItemIds = new Set(oldItems.map(item => item.itemId));
        return newItems.filter(item => !oldItemIds.has(item.itemId));
    }
}