import { NotificationSettings } from './notification.types';

export interface User {
    id: string;
    rateLimits: {
        activeMonitors: number;
        apiCallsPerHour: number;
        notificationsPerDay: number;
    };
    notificationSettings: NotificationSettings;
}