// src/services/email.service.ts
import { SES } from '@aws-sdk/client-ses';
import { emailConfig } from '../config/email.config';
import { EbayItem } from '../types/ebay.types';

export class EmailService {
  private ses: SES;

  constructor() {
    this.ses = new SES({
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
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
        ToAddresses: [to],
      },

      Message: {
        Subject: {
          Data: `Confirmation Code for eSentry: ${verificationPin}`,
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
            `,
          },
        },
      },
    });
  }

  async sendNewItemsNotification(
    to: string,
    monitorTitle: string,
    newItems: EbayItem[],
    monitorId: string
  ): Promise<void> {
    const monitorUrl = `${process.env.FRONTEND_URL}/monitors/${monitorId}`;

    // Build item cards (responsive, larger images)
    const itemsHtml = newItems
      .map((item, i) => {
        const itemUrl =
          (item as any).itemUrl ?? (item as any).itemWebUrl ?? '#';
        const imgUrl = item.image?.imageUrl ?? '';
        const titleSafe = item.title ?? 'Untitled item';
        const price = item.price
          ? `${item.price.value} ${item.price.currency}`
          : 'Price unavailable';
        const condition = item.condition ? item.condition : '';
        const seller = item.seller
          ? `${item.seller.username} (${item.seller.feedbackScore ?? '–'})`
          : 'Seller info unavailable';

        return `
<tr class="item-card" style="border-bottom:1px solid #e6e9ee;">
  <td style="padding:16px;">
    <!-- Container with two-column layout on desktop, stacked on mobile -->
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        <!-- Image column -->
        <td valign="top" style="width:200px; max-width:200px; padding-right:12px;">
          <a href="${itemUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
            ${
              imgUrl
                ? `
              <img
                src="${imgUrl}"
                alt="${escapeHtml(titleSafe)}"
                class="item-image"
                style="display:block; width:100%; max-width:200px; height:auto; border-radius:8px; object-fit:cover;"
              />
            `
                : `
              <div style="display:flex; align-items:center; justify-content:center; width:100%; max-width:200px; height:140px; background:#f5f7fa; color:#8b95a6; border-radius:8px; font-size:14px;">
                No image
              </div>
            `
            }
          </a>
        </td>

        <!-- Details column -->
        <td valign="top" style="padding-top:4px;">
          <h3 style="margin:0 0 8px 0; font-size:16px; line-height:1.25; color:#0f1724;">
            <a href="${itemUrl}" target="_blank" rel="noopener noreferrer" style="color:inherit; text-decoration:none;">
              ${escapeHtml(titleSafe)}
            </a>
          </h3>

          <p style="margin:0 0 8px 0; font-size:15px; font-weight:600; color:#0b6b3b;">
            ${escapeHtml(price)}
          </p>

          ${condition ? `<p style="margin:0 0 8px 0; font-size:13px; color:#425466;">Condition: ${escapeHtml(condition)}</p>` : ''}

          <p style="margin:0 0 12px 0; font-size:13px; color:#6b7280;">Seller: ${escapeHtml(seller)}</p>

          <p style="margin:0;">
            <a href="${itemUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block; padding:8px 12px; text-decoration:none; border-radius:6px; background:#0b74ff; color:#ffffff; font-size:13px;">
              View item
            </a>
            <a href="${monitorUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block; margin-left:8px; padding:8px 12px; text-decoration:none; border-radius:6px; border:1px solid #d1d5db; color:#111827; font-size:13px;">
              View monitor
            </a>
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
      `;
      })
      .join('\n');

    // Main HTML template (responsive)
    const htmlContent = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>New items found</title>
  <style>
    /* Basic reset */
    body { margin:0; padding:0; background:#f3f4f6; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial; color:#111827; }
    a { color:inherit; }
    .container { width:100%; max-width:720px; margin:0 auto; background:#ffffff; border-radius:10px; overflow:hidden; }
    .header { padding:20px; text-align:left; background:linear-gradient(90deg,#0b74ff,#0066d6); color:#fff; }
    .preheader { display:none !important; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden; mso-hide:all; }
    .content { padding:20px; }
    .summary { margin:0 0 16px 0; }
    .items-table { width:100%; border-collapse:collapse; }
    /* Mobile adjustments */
    @media only screen and (max-width:600px) {
      .container { border-radius:0; }
      .header { padding:16px; text-align:center; }
      .item-card td { display:block !important; width:100% !important; box-sizing:border-box; padding:12px !important; }
      .item-card td:first-child { padding-right:0 !important; }
      .item-image { max-width:100% !important; width:100% !important; height:auto !important; border-radius:8px; }
      .item-card h3 { font-size:16px !important; }
    }
  </style>
</head>
<body>
  <!-- Hidden preheader: short summary shown in inbox preview -->
  <div class="preheader">We've found ${newItems.length} new item${newItems.length > 1 ? 's' : ''} for "${escapeHtml(monitorTitle)}"</div>

  <center style="width:100%; padding:20px 12px;">
    <table role="presentation" class="container" width="100%">
      <tr>
        <td class="header">
          <h1 style="margin:0; font-size:20px;">New eBay items found</h1>
          <p style="margin:6px 0 0 0; font-size:13px; opacity:0.95;">${escapeHtml(monitorTitle)}</p>
        </td>
      </tr>

      <tr>
        <td class="content">
          <p class="summary" style="margin:0 0 12px 0; font-size:14px; color:#374151;">
            We found <strong>${newItems.length}</strong> new item${newItems.length > 1 ? 's' : ''} matching your monitor — quick summary below.
          </p>

          <table role="presentation" class="items-table" width="100%">
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <p style="margin:16px 0 0 0; font-size:13px; color:#6b7280;">
            You received this email because you set up notifications for eBay listings on eSentry.
            <br/>
            Manage notifications or edit this monitor: <a href="${monitorUrl}" target="_blank" rel="noopener noreferrer">${monitorUrl}</a>
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:16px; text-align:center; font-size:12px; color:#9ca3af;">
          © ${new Date().getFullYear()} eSentry — All rights reserved
        </td>
      </tr>
    </table>
  </center>
</body>
</html>
    `;

    // Plain-text fallback (useful for inbox previews / clients without HTML)
    const textLines: string[] = [
      `New items found for "${monitorTitle}"`,
      `Found ${newItems.length} new item${newItems.length > 1 ? 's' : ''}`,
      '',
      ...newItems.map((item) => {
        const itemUrl = (item as any).itemUrl ?? (item as any).itemWebUrl ?? '';
        const title = item.title ?? 'Untitled item';
        const price = item.price
          ? `${item.price.value} ${item.price.currency}`
          : 'Price unavailable';
        const condition = item.condition ? `Condition: ${item.condition}` : '';
        const seller = item.seller
          ? `Seller: ${item.seller.username} (${item.seller.feedbackScore ?? '–'})`
          : '';
        return [title, price, condition, seller, itemUrl || '', '---']
          .filter(Boolean)
          .join('\n');
      }),
    ];

    const textContent = textLines.join('\n');

    // Send email (Html + Text)
    await this.ses.sendEmail({
      Source: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: `eSentry - New items found for "${monitorTitle}"` },
        Body: {
          Html: { Data: htmlContent },
          Text: { Data: textContent },
        },
      },
    });
  }

  async sendAccountVerificationEmail(to: string, token: string): Promise<void> {
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
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Data: 'Verify Your eSentry Account',
        },
        Body: {
          Html: {
            Data: htmlContent,
          },
        },
      },
    });
  }

  async sendPasswordResetEmail(
    to: string,
    token: string | null
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
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Data: 'Reset Your eSentry Password',
        },
        Body: {
          Html: {
            Data: htmlContent,
          },
        },
      },
    });
  }
}
/**
 * Utility: HTML escaper for text injected into templates.
 * Keeps the template safe from accidental HTML injection from item fields.
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
