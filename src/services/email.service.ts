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
  plainText?: string;
}

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

    if (config.enabledEmails.length > 0 && !config.enabledEmails.includes(templateCode)) {
      logger.warn(`EMAIL | SKIPPED | Email ${templateCode} not in enabled list for ${countryCode}`);
      return { success: false, reason: 'EMAIL_DISABLED' };
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

    // Add Branding / Footer
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

    // 5. Setup Transporter
    // SMARTER TRANSPORT: Auto-resolve secure flag based on port to prevent handshake timeouts
    const isSecurePort = config.smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: isSecurePort, // true for 465, false for 587/others
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass
      },
      connectionTimeout: 20000, // 20s for production stability
      greetingTimeout: 10000,
      socketTimeout: 30000,
      tls: {
          // Do not fail on invalid certificates (Common in relay nodes)
          rejectUnauthorized: false
      }
    });

    // 6. Send
    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
      text,
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

    const isSecurePort = config.smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: isSecurePort,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass
      },
      connectionTimeout: 20000,
      greetingTimeout: 10000,
      tls: {
          rejectUnauthorized: false
      }
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
