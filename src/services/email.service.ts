import nodemailer from 'nodemailer';
import { emailConfig } from '../config/email.config';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: emailConfig.auth,
    });
  }

  async sendVerificationEmail(
    to: string,
    verificationToken: string,
    verificationPin: string
  ): Promise<void> {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

    await this.transporter.sendMail({
      from: emailConfig.from,
      to,
      subject: 'eSentry - Verify your email address',
      html: `
        <h1>Email Verification</h1>
        <p>Please verify your email address by clicking the link below or entering the PIN code:</p>
        <p><a href="${verificationUrl}">Click here to verify your email</a></p>
        <p>Or enter this PIN code: <strong>${verificationPin}</strong></p>
        <p>This verification will expire in 24 hours.</p>
      `,
    });
  }
}
