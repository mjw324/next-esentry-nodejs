export interface AlertEmail {
  id: string;
  email: string;
  status: string; // "active", "pending verification", "ready"
  verificationToken?: string;
  verificationPin?: string;
  verificationExpires?: Date;
  verificationAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  name?: string;
  email: string;
  emailVerified?: Date;
  password?: string;
  lastLoggedIn?: Date;
  image?: string;
  rateLimits: {
    maxActiveMonitors: number;
    maxApiCallsPerHour: number;
    maxNotificationsPerDay: number;
  };
  alertEmails: AlertEmail[];
  createdAt: Date;
  updatedAt: Date;
}