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
    const html = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; margin: 0; padding: 0;">
          <div style="max-width: 600px; margin: 20px auto; border: 1px solid #eee; padding: 40px; border-radius: 20px; background-color: #fff;">
            ${config.branding.logoUrl ? `<div style="text-align: center; margin-bottom: 30px;"><img src="${config.branding.logoUrl}" alt="Logo" style="max-height: 60px;"></div>` : ''}
            <div style="margin-bottom: 40px; font-size: 16px; color: #444;">
              ${body}
            </div>
            <div style="border-top: 1px solid #f0f0f0; padding-top: 30px; font-size: 12px; color: #999; text-align: center;">
              <p style="margin-bottom: 10px;">${footer}</p>
              <p style="margin-top: 10px; font-weight: bold;">
                ${config.branding.companyName || 'PieceJob'}<br>
                ${config.branding.companyAddress || ''}
              </p>
              <p>Support: ${config.branding.supportEmail || ''} | ${config.branding.supportPhone || ''}</p>
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
