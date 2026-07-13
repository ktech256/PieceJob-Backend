import nodemailer from 'nodemailer';
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
}

export const sendEmail = async (options: EmailOptions) => {
  const { to, templateCode, templateData, countryCode, attachments = [] } = options;

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
    if (!config.enabledCategories[template.category]) {
      logger.warn(`EMAIL | SKIPPED | Category ${template.category} disabled for ${countryCode}`);
      return { success: false, reason: 'CATEGORY_DISABLED' };
    }

    if (config.enabledEmails.length > 0 && !config.enabledEmails.includes(templateCode)) {
      logger.warn(`EMAIL | SKIPPED | Email ${templateCode} not in enabled list for ${countryCode}`);
      return { success: false, reason: 'EMAIL_DISABLED' };
    }

    // 4. Resolve Template
    let subject = template.subject || 'PieceJob Notification';
    let body = template.body;

    Object.entries(templateData).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder, 'g');
      subject = subject.replace(regex, value);
      body = body.replace(regex, value);
    });

    // Add Branding / Footer
    const footer = config.emailSignature || '';
    body = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <div style="max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            ${config.branding.logoUrl ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${config.branding.logoUrl}" alt="Logo" style="max-height: 50px;"></div>` : ''}
            <div style="margin-bottom: 30px;">
              ${body}
            </div>
            <div style="border-top: 1px solid #eee; padding-top: 20px; font-size: 12px; color: #777;">
              ${footer}
              <p style="margin-top: 10px;">
                ${config.branding.companyName || 'PieceJob'}<br>
                ${config.branding.companyAddress || ''}
              </p>
              <p>Support: ${config.branding.supportEmail || ''} | ${config.branding.supportPhone || ''}</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // 5. Setup Transporter
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass
      }
    });

    // 6. Send
    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html: body,
      attachments
    });

    logger.email('SENT', 'SUCCESS', to, `MsgId: ${info.messageId} | Template: ${templateCode}`);

    // 7. Log
    await EmailLog.create({
      recipient: to,
      subject,
      body,
      templateCode,
      countryCode,
      status: 'SENT',
      messageId: info.messageId,
      sentAt: new Date()
    });

    return { success: true, messageId: info.messageId };

  } catch (error: any) {
    logger.error(`EMAIL | FAILED | To: ${to} | Error: ${error.message}`);

    await EmailLog.create({
      recipient: to,
      subject: templateCode, // Fallback if resolution fails
      body: 'FAILED',
      templateCode,
      countryCode,
      status: 'FAILED',
      errorMessage: error.message
    });

    return { success: false, error: error.message };
  }
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

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass
      },
      connectionTimeout: 10000, // 10s timeout for tests
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
      message: 'SMTP Connection Failed',
      error: error.message,
      latency: Date.now() - startTime
    };
  }
};
