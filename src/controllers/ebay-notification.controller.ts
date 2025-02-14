import { Request, Response } from 'express';
import { EbayNotificationService } from '../services/ebay-notification.service';

export class EbayNotificationController {
    constructor(private notificationService: EbayNotificationService) {}

    handleChallenge = (req: Request, res: Response): void => {
        const challengeCode = req.query.challenge_code as string;

        if (!challengeCode) {
            res.status(400).json({ error: 'Challenge code is required' });
            return;
        }

        const challengeResponse = this.notificationService.validateChallenge(challengeCode);

        res.setHeader('Content-Type', 'application/json');
        res.status(200).json({ challengeResponse });
    };

    handleNotification = async (req: Request, res: Response): Promise<void> => {
        try {
            if (req.body.metadata?.topic === 'MARKETPLACE_ACCOUNT_DELETION') {
                await this.notificationService.processAccountDeletion(req.body);
                res.status(200).send();
            } else {
                res.status(400).json({ error: 'Unsupported notification type' });
            }
        } catch (error) {
            console.error('Error processing notification:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}
