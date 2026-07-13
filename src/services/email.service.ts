import nodemailer from 'nodemailer';
import axios from 'axios';
import EmailConfig, { IEmailConfig } from '../models/EmailConfig';
import EmailLog from '../models/EmailLog';
import NotificationTemplate from '../models/NotificationTemplate';
import { logger } from '../utils/logger';

export interface EmailOptions {
  to: string;
  templateCode: string;
  templateData: Record<string, string>;
  countryCode: string;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
  plainText?: string;
}

/**
 * Enterprise Email Dispatch Engine
 * Supports SMTP Fallback and Direct API Integration for reliability in Cloud environments.
 */
export const sendEmail = async (options: EmailOptions) => {
  const { to, templateCode, templateData, countryCode, attachments = [], plainText } = options;

  try {
    // 1. Fetch Config
    let config = await EmailConfig.findOne({ countryCode });
    if (!config && countryCode !== 'GLOBAL') {
      config = await EmailConfig.findOne({ countryCode: 'GLOBAL' });
    }

    if (!config || !config.enabled) {
      logger.warn(`EMAIL | SKIPPED | System disabled for ${countryCode}`);
      return { success: false, reason: 'SYSTEM_DISABLED' };
    }

    // 2. Fetch Template
    const template = await NotificationTemplate.findOne({ templateCode, channel: 'EMAIL', active: true, $or: [{ countryCode }, { countryCode: 'GLOBAL' }] }).sort({ countryCode: -1 });

    if (!template) {
      logger.error(`EMAIL | FAILED | Template ${templateCode} not found`);
      return { success: false, reason: 'TEMPLATE_NOT_FOUND' };
    }

    // 3. Check if specific email category/code is enabled
    const categoryKey = template.category as keyof typeof config.enabledCategories;
    if (config.enabledCategories[categoryKey] === false) {
      logger.warn(`EMAIL | SKIPPED | Category ${template.category} disabled for ${countryCode}`);
      return { success: false, reason: 'CATEGORY_DISABLED' };
    }

    // 4. Resolve Template
    let subject = template.subject || 'PieceJob Notification';
    let body = template.body;
    let text = plainText || template.plainTextBody || '';

    Object.entries(templateData).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder, 'g');
      subject = subject.replace(regex, value);
      body = body.replace(regex, value);
      if (text) text = text.replace(regex, value);
    });

    // Wrap in Global Branding
    const footer = config.emailSignature || '';
    const primaryColor = template.category === 'PROVIDER' ? '#2E7D32' : '#D32F2F'; // Green for Pro, Red for Customer
    const brandName = config.branding.companyName || 'PieceJob';
    const logoUrl = config.branding.logoUrl || 'https://api.piecejob.co/assets/logo-primary.png'; // Fallback to PieceJob Global Logo

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; color: #333333; }
            .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08); }
            .header { padding: 40px 20px; text-align: center; background-color: #121212; }
            .content { padding: 50px; line-height: 1.8; }
            .footer { padding: 40px; background-color: #fafafa; text-align: center; font-size: 11px; color: #999999; border-top: 1px solid #eeeeee; }
            .button { display: inline-block; padding: 18px 36px; background-color: ${primaryColor}; color: #ffffff !important; text-decoration: none; border-radius: 14px; font-weight: 800; margin-top: 30px; text-transform: uppercase; letter-spacing: 0.1em; font-size: 12px; }
            .card { background-color: #f9f9f9; border-radius: 20px; padding: 30px; margin: 30px 0; border: 1px solid #f0f0f0; }
            .detail-row { display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px dashed #e0e0e0; padding-bottom: 12px; }
            .detail-row:last-child { border-bottom: none; }
            .detail-label { font-weight: 800; color: #888888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }
            .detail-value { font-weight: 700; color: #121212; text-align: right; font-size: 13px; }
            h1 { font-size: 28px; font-weight: 900; color: #121212; margin-top: 0; margin-bottom: 20px; letter-spacing: -0.03em; line-height: 1.2; }
            p { margin-bottom: 20px; font-size: 16px; color: #555555; }
            .highlight { color: ${primaryColor}; font-weight: 900; }
            @media (max-width: 600px) {
              .container { margin: 0; border-radius: 0; width: 100%; }
              .content { padding: 35px 25px; }
              .h1 { font-size: 24px; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <img src="${logoUrl}" alt="${brandName}" style="max-height: 50px;">
            </div>
            <div class="content">
              ${body}
            </div>
            <div class="footer">
              <div style="margin-bottom: 25px;">
                ${footer}
              </div>
              <p style="margin: 0; font-weight: 900; color: #121212; text-transform: uppercase; letter-spacing: 0.2em; font-size: 10px;">${brandName}</p>
              <p style="margin: 6px 0; font-size: 10px;">${config.branding.companyAddress || ''}</p>
              <p style="margin: 15px 0;">
                <a href="mailto:${config.branding.supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 700;">Support Centre</a> &nbsp;•&nbsp;
                <a href="https://piecejob.co/terms" style="color: #999; text-decoration: none;">Terms of Service</a> &nbsp;•&nbsp;
                <a href="https://piecejob.co/privacy" style="color: #999; text-decoration: none;">Privacy Policy</a>
              </p>
              <div style="margin-top: 30px; opacity: 0.5;">
                <img src="https://api.piecejob.co/assets/social-icons.png" alt="Social" style="max-height: 20px;">
              </div>
              <p style="margin-top: 25px; font-size: 9px; opacity: 0.4; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;">© ${new Date().getFullYear()} PieceJob Global Oracle node. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    let messageId = 'PENDING';

    // 5. MISSION CRITICAL: Determine Delivery Route
    // If provider is SENDGRID and SMTP is timing out, use HTTP API as high-reliability override
    if (config.smtpProvider === 'SENDGRID') {
        try {
            logger.info(`EMAIL | ROUTE | Using SendGrid HTTP API for ${to}`);
            const response = await axios.post('https://api.sendgrid.com/v3/mail/send', {
                personalizations: [{ to: [{ email: to }] }],
                from: { email: config.fromEmail, name: config.fromName },
                reply_to: config.replyTo ? { email: config.replyTo } : undefined,
                subject,
                content: [
                    { type: 'text/plain', value: text || 'PieceJob Notification' },
                    { type: 'text/html', value: html }
                ]
            }, {
                headers: { 'Authorization': `Bearer ${config.smtpPass}` }
            });
            messageId = response.headers['x-message-id'] || 'SG-API-SUCCESS';
        } catch (apiError: any) {
            logger.error(`EMAIL | SENDGRID_API_FAILED | Falling back to SMTP: ${apiError.response?.data?.errors?.[0]?.message || apiError.message}`);
            // If API fails, fall through to standard SMTP logic below
            return await dispatchViaSmtp(to, subject, html, text, attachments, config, templateCode, countryCode);
        }
    } else {
        return await dispatchViaSmtp(to, subject, html, text, attachments, config, templateCode, countryCode);
    }

    // Success Logging for API route
    await EmailLog.create({
      recipient: to,
      subject,
      body: 'HTML_REDACTED',
      templateCode,
      countryCode,
      status: 'SENT',
      messageId,
      sentAt: new Date()
    });

    return { success: true, messageId };

  } catch (error: any) {
    logger.error(`EMAIL | FATAL | To: ${to} | Error: ${error.message}`);
    await EmailLog.create({
      recipient: to,
      subject: templateCode,
      body: 'FAILED',
      templateCode,
      countryCode,
      status: 'FAILED',
      errorMessage: error.message
    });
    return { success: false, error: error.message };
  }
};

/**
 * Standard SMTP Dispatch Logic
 */
const dispatchViaSmtp = async (to: string, subject: string, html: string, text: string, attachments: any[], config: any, templateCode: string, countryCode: string) => {
    const isSecurePort = config.smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: isSecurePort,
      auth: { user: config.smtpUser, pass: config.smtpPass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      tls: { rejectUnauthorized: false }
    });

    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
      text,
      attachments
    });

    logger.email('SENT', 'SUCCESS', to, `MsgId: ${info.messageId} | SMTP`);

    await EmailLog.create({
      recipient: to,
      subject,
      body: 'HTML_REDACTED',
      templateCode,
      countryCode,
      status: 'SENT',
      messageId: info.messageId,
      sentAt: new Date()
    });

    return { success: true, messageId: info.messageId };
};

export interface SMTPDiagnosticResult {
  success: boolean;
  message: string;
  banner?: string;
  latency?: number;
  provider?: string;
  secure?: boolean;
  error?: any;
}

export const testSmtpConnection = async (countryCode: string): Promise<SMTPDiagnosticResult> => {
  const startTime = Date.now();
  try {
    let config = await EmailConfig.findOne({ countryCode });
    if (!config && countryCode !== 'GLOBAL') {
      config = await EmailConfig.findOne({ countryCode: 'GLOBAL' });
    }

    if (!config) throw new Error('NO_CONFIG_FOUND');

    // SPECIAL CASE: If using SendGrid, validate via API ping instead of port 587
    if (config.smtpProvider === 'SENDGRID') {
        try {
            await axios.get('https://api.sendgrid.com/v3/scopes', {
                headers: { 'Authorization': `Bearer ${config.smtpPass}` }
            });
            return {
                success: true,
                message: 'SendGrid API Verified (SMTP Port 587 likely blocked by Render, but Oracle API is UP)',
                latency: Date.now() - startTime,
                provider: 'SENDGRID_API'
            };
        } catch (apiErr: any) {
            return { success: false, message: 'SendGrid API Auth Failed', error: apiErr.message };
        }
    }

    const isSecurePort = config.smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: isSecurePort,
      auth: { user: config.smtpUser, pass: config.smtpPass },
      connectionTimeout: 10000,
      tls: { rejectUnauthorized: false }
    });

    await transporter.verify();
    const latency = Date.now() - startTime;

    return {
      success: true,
      message: 'SMTP Connection Successful',
      latency,
      secure: config.smtpSecure,
      provider: config.smtpProvider
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'SMTP Connection Failed. Tip: Try Port 2525 or 465 if 587 is blocked by your cloud provider.',
      error: error.message,
      latency: Date.now() - startTime
    };
  }
};
