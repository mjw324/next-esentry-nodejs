export const emailConfig = {
  host: process.env.AWS_SES_SMTP_ENDPOINT || 'email-smtp.us-east-1.amazonaws.com',
  port: parseInt(process.env.AWS_SES_SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
      user: process.env.AWS_SES_SMTP_USERNAME,
      pass: process.env.AWS_SES_SMTP_PASSWORD,
  },
  from: process.env.AWS_SES_FROM_EMAIL || 'noreply@esentry.dev',
  verificationTokenExpiry: 24 * 60 * 60 * 1000, // 24 hours
  maxVerificationAttempts: 3,
};
