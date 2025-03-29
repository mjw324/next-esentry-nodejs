// src/services/email.service.ts
import { SES } from '@aws-sdk/client-ses';
import { emailConfig } from '../config/email.config';
import { EbayItem } from '../types/ebay.types';

export class EmailService {
  private ses: SES;

  constructor() {
    this.ses = new SES({
      region: 'us-east-2',
      credentials: {
        accessKeyId: process.env.AWS_SES_SMTP_USERNAME || '',
        secretAccessKey: process.env.AWS_SES_SMTP_PASSWORD || ''
      }
    });
  }

  async sendVerificationEmail(
    to: string,
    verificationToken: string,
    verificationPin: string
  ): Promise<void> {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

    await this.ses.sendEmail({
      Source: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: `Confirmation Code for eSentry: ${verificationPin}`
        },
        Body: {
          Html: {
            Data: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Email Verification</title>
                <style>
                  .body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                  }
                  h1 {
                    font-size: 32px;
                    color:rgb(5, 0, 56);
                    margin-bottom: 15px;
                  }
                  .instructions {
                    color:rgb(117, 115, 147);
                    font-size: 16px;
                    margin-bottom: 25px;
                  }
                  .code-container {
                    background-color: #f5f5f7;
                    padding: 30px;
                    text-align: center;
                    margin-bottom: 25px;
                  }
                  .verification-code {
                    font-size: 40px;
                    font-weight: bold;
                    color:rgb(5, 0, 56);
                    letter-spacing: 2px;
                  }
                  .button-instruction {
                    color: rgb(109, 106, 139);
                    font-weight: 600;
                    margin-bottom: 15px;
                  }
                  .confirm-button {
                    display: inline-block;
                    background-color: #d8e7ff;
                    color: color:rgb(5, 0, 56);
                    text-decoration: none;
                    padding: 15px 30px;
                    border-radius: 4px;
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 30px;
                  }
                  .footer-note {
                    color: rgb(117, 115, 147);
                    font-size: 14px;
                  }
                </style>
              </head>
              <body>
                <div class="body">
                  <h1>Complete verification</h1>

                  <p class="instructions">
                    Please enter this confirmation code in eSentry:
                  </p>

                  <div class="code-container">
                    <div class="verification-code">${verificationPin}</div>
                  </div>

                  <p class="button-instruction">
                    Or click this button to confirm your email:
                  </p>

                  <a href="${verificationUrl}" class="confirm-button">Confirm your email</a>

                  <p class="footer-note">
                    If you didn't create an account in eSentry, please ignore this message.
                  </p>
                </div>
              </body>
              </html>
            `
          }
        }
      }
    });
  }

  async sendNewItemsNotification(
    to: string,
    monitorTitle: string,
    newItems: EbayItem[],
    monitorId: string
  ): Promise<void> {
    const monitorUrl = `${process.env.FRONTEND_URL}/monitors/${monitorId}`;

    // Generate HTML for items
    const itemsHtml = newItems.map(item => `
      <div style="margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
        <div style="display: flex; align-items: flex-start;">
          <div style="margin-right: 15px; width: 120px;">
            <img src="${item.image.imageUrl}" alt="${item.title}" style="max-width: 100%; border-radius: 4px;">
          </div>
          <div>
            <h3 style="margin-top: 0; margin-bottom: 5px;">
              <a href="${item.itemWebUrl}" style="color: #1a73e8; text-decoration: none;">${item.title}</a>
            </h3>
            <p style="font-size: 18px; font-weight: bold; margin: 5px 0;">
              ${item.price.value} ${item.price.currency}
            </p>
            ${item.condition ? `
            <p style="margin: 5px 0; color: #666;">
              Condition: ${item.condition}
            </p>` : ''}
            <p style="margin: 5px 0; color: #666;">
              Seller: ${item.seller.username} (${item.seller.feedbackScore})
            </p>
          </div>
        </div>
      </div>
    `).join('');

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px;">
          New Items Found!
        </h1>

        <p style="font-size: 16px; line-height: 1.5;">
          We've found ${newItems.length} new item${newItems.length > 1 ? 's' : ''} 
          matching your "${monitorTitle}" monitor.
        </p>

        <div style="margin: 25px 0;">
          ${itemsHtml}
        </div>

        <p style="color: #666; margin-top: 30px; font-size: 12px; text-align: center;">
          You received this email because you set up notifications for eBay listings. 
          <br>To manage your notification settings, visit 
          <a href="${process.env.FRONTEND_URL}/dashboard" style="color: #1a73e8;">eSentry</a>.
        </p>
      </div>
    `;

    await this.ses.sendEmail({
      Source: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: `eSentry - New items found for "${monitorTitle}"`
        },
        Body: {
          Html: {
            Data: htmlContent
          }
        }
      }
    });
  }

  async sendAccountVerificationEmail(
    to: string,
    token: string
  ): Promise<void> {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account/${token}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Verification</title>
        <style>
          .body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          h1 {
            font-size: 32px;
            color: rgb(5, 0, 56);
            margin-bottom: 15px;
          }
          .instructions {
            color: rgb(117, 115, 147);
            font-size: 16px;
            margin-bottom: 25px;
          }
          .button-container {
            text-align: center;
            margin: 30px 0;
          }
          .verify-button {
            display: inline-block;
            background-color: #d8e7ff;
            color: color:rgb(5, 0, 56);
            text-decoration: none;
            padding: 15px 30px;
            border-radius: 5px;
            font-size: 16px;
            font-weight: 600;
          }
          .footer-note {
            color: rgb(117, 115, 147);
            font-size: 14px;
            margin-top: 25px;
          }
          .expiry-note {
            color: rgb(117, 115, 147);
            font-size: 14px;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="body">
          <h1>Welcome to eSentry!</h1>

          <p class="instructions">
            Thanks for signing up. Please verify your email address to complete your registration.
          </p>

          <div class="button-container">
            <a href="${verificationUrl}" class="verify-button">
              Verify Email Address
            </a>
          </div>

          <p class="footer-note">
            If you didn't sign up for eSentry, you can safely ignore this email.
          </p>

          <p class="expiry-note">
            This link will expire in 24 hours.
          </p>
        </div>
      </body>
      </html>
    `;

    await this.ses.sendEmail({
      Source: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: 'Verify Your eSentry Account'
        },
        Body: {
          Html: {
            Data: htmlContent
          }
        }
      }
    });
  }

  async sendPasswordResetEmail(
    to: string,
    token: string
  ): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>
          .body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          h1 {
            font-size: 32px;
            color: rgb(5, 0, 56);
            margin-bottom: 15px;
          }
          .instructions {
            color: rgb(117, 115, 147);
            font-size: 16px;
            margin-bottom: 25px;
          }
          .button-container {
            text-align: center;
            margin: 30px 0;
          }
          .reset-button {
            display: inline-block;
            background-color: #d8e7ff;
            color: color:rgb(5, 0, 56);
            text-decoration: none;
            padding: 15px 30px;
            border-radius: 5px;
            font-size: 16px;
            font-weight: 600;
          }
          .footer-note {
            color: rgb(117, 115, 147);
            font-size: 14px;
            margin-top: 25px;
          }
          .expiry-note {
            color: rgb(117, 115, 147);
            font-size: 14px;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="body">
          <h1>Reset Your Password</h1>

          <p class="instructions">
            You requested a password reset for your eSentry account. Click the button below to set a new password:
          </p>

          <div class="button-container">
            <a href="${resetUrl}" class="reset-button">
              Reset Password
            </a>
          </div>

          <p class="footer-note">
            If you didn't request this password reset, you can safely ignore this email.
          </p>

          <p class="expiry-note">
            This link will expire in 1 hour.
          </p>
        </div>
      </body>
      </html>
    `;

    await this.ses.sendEmail({
      Source: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: 'Reset Your eSentry Password'
        },
        Body: {
          Html: {
            Data: htmlContent
          }
        }
      }
    });
  }
}
