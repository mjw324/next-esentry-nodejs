// src/types/notification.types.ts
export interface EmailSettings {
  userId: string;
  activeEmail: {
    id: string;
    email: string;
    status: string;
  } | null;
}

export type NotificationType = 'MONITOR_RESULTS' | 'VERIFICATION' | 'SYSTEM';

export interface NotificationPayload {
  userId: string;
  monitorId: string;
  type: NotificationType;
  message: string;
  data: Record<string, any>;
}
