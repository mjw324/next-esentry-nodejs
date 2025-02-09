export interface NotificationSettings {
    userId: string;
    channels: {
        email?: {
            enabled: boolean;
            address: string;
        };
        sms?: {
            enabled: boolean;
            phoneNumber: string;
        };
        push?: {
            enabled: boolean;
            token: string;
        };
    };
}

export interface NotificationPayload {
    userId: string;
    monitorId: string;
    type: 'MONITOR_RESULTS' | 'MONITOR_ERROR' | 'SYSTEM';
    message: string;
    data?: Record<string, any>;
}

export interface NotificationChannel {
    type: 'email' | 'sms' | 'push';
    enabled: boolean;
    destination: string;
}