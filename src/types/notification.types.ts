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
  /**
   * Display title for the monitor (its keywords, joined). Passed in by the
   * caller, which already holds the monitor row -- the notification service
   * used to re-read the monitor from the database purely to build this.
   */
  monitorTitle: string;
  type: NotificationType;
  message: string;
  data: Record<string, any>;
}
