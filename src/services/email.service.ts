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

    // STRICT VALIDATION: Ensure no unresolved placeholders remain
    const unresolved = body.match(/{{[a-zA-Z0-9_]+}}/g);
    if (unresolved) {
      logger.error(`EMAIL | VALIDATION_FAILED | Template: ${templateCode} | Missing: ${unresolved.join(', ')}`);
      return { success: false, reason: 'UNRESOLVED_PLACEHOLDERS', missing: unresolved };
    }

    // Wrap in Premium Enterprise Branding
    const footer = config.emailSignature || '';
    const isProvider = template.category === 'PROVIDER';
    const primaryColor = isProvider ? '#1A56DB' : '#FF9900'; // Royal Blue for Pro, Orange for Customer
    const brandName = config.branding.companyName || 'PieceJob';
    const logoUrl = config.branding.logoUrl || 'https://piecejob.co/assets/logos/piecejob-logo.png';

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { margin: 0; padding: 0; background-color: #f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
          .wrapper { width: 100%; table-layout: fixed; background-color: #f8f9fa; padding-bottom: 60px; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; margin-top: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.05); }
          .header { background-color: #121212; padding: 60px 40px; text-align: center; }
          .logo { height: 100px; width: auto; }
          .content { padding: 60px 50px; color: #1a1a1a; line-height: 1.7; }
          .h1 { font-size: 32px; font-weight: 800; margin: 0 0 24px 0; letter-spacing: -0.04em; color: #121212; line-height: 1.1; }
          .p { font-size: 16px; margin: 0 0 20px 0; color: #4a4a4a; }
          .button { display: inline-block; padding: 20px 40px; background-color: ${primaryColor}; color: #ffffff !important; text-decoration: none; border-radius: 16px; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 20px; box-shadow: 0 8px 25px ${primaryColor}44; }
          .card { background-color: #fcfcfc; border: 1px solid #f0f0f0; border-radius: 20px; padding: 32px; margin: 40px 0; }
          .detail-row { display: table; width: 100%; margin-bottom: 12px; border-bottom: 1px solid #f5f5f5; padding-bottom: 12px; }
          .detail-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
          .label { display: table-cell; font-size: 11px; font-weight: 800; color: #999; text-transform: uppercase; letter-spacing: 0.1em; width: 40%; }
          .value { display: table-cell; font-size: 14px; font-weight: 700; color: #121212; text-align: right; }
          .footer { padding: 50px 40px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #f5f5f5; }
          .social-links { margin-top: 30px; }
          .social-icon { display: inline-block; margin: 0 10px; opacity: 0.4; }
          @media screen and (max-width: 600px) {
            .container { margin-top: 0; border-radius: 0; width: 100% !important; }
            .content { padding: 40px 30px; }
            .h1 { font-size: 26px; }
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="header">
              <img src="${logoUrl}" alt="${brandName}" class="logo">
            </div>
            <div class="content">
              ${body}
            </div>
            <div class="footer">
              <div style="margin-bottom: 25px;">${footer}</div>
              <p style="margin: 0; font-weight: 800; color: #121212; text-transform: uppercase; letter-spacing: 0.2em;">${brandName}</p>
              <p style="margin: 6px 0;">${config.branding.companyAddress || ''}</p>
              <div class="social-links">
                <a href="#" class="social-icon"><img src="https://api.piecejob.co/assets/icons/social-fb.png" width="20"></a>
                <a href="#" class="social-icon"><img src="https://api.piecejob.co/assets/icons/social-ig.png" width="20"></a>
                <a href="#" class="social-icon"><img src="https://api.piecejob.co/assets/icons/social-tw.png" width="20"></a>
              </div>
              <p style="margin-top: 30px; opacity: 0.5;">© ${new Date().getFullYear()} PieceJob Global Oracle node. All rights reserved.</p>
            </div>
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
