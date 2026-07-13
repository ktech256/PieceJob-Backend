import mongoose, { Schema, Document } from 'mongoose';

export interface IEmailConfig extends Document {
  countryCode: string; // "GLOBAL" or ISO code
  enabled: boolean;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  smtpProvider: 'SMTP' | 'SENDGRID' | 'MAILGUN' | 'SES' | 'OFF';
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure: boolean;
  emailSignature?: string;
  branding: {
    logoUrl?: string;
    primaryColor?: string;
    companyName?: string;
    companyAddress?: string;
    supportEmail?: string;
    supportPhone?: string;
  };
  enabledCategories: {
    ACCOUNT: boolean;
    CUSTOMER: boolean;
    PROVIDER: boolean;
    WALLET: boolean;
    REFERRAL: boolean;
    AFFILIATE: boolean;
    MARKETING: boolean;
    LEGAL: boolean;
    ADMIN: boolean;
    SECURITY: boolean;
  };
  enabledEmails: string[]; // List of templateCodes that are enabled
}

const EmailConfigSchema: Schema = new Schema({
  countryCode: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  fromName: { type: String, required: true, default: 'PieceJob' },
  fromEmail: { type: String, required: true, default: 'no-reply@piecejob.co' },
  replyTo: { type: String },
  smtpProvider: { type: String, enum: ['SMTP', 'SENDGRID', 'MAILGUN', 'SES', 'OFF'], default: 'SMTP' },
  smtpHost: { type: String },
  smtpPort: { type: Number },
  smtpUser: { type: String },
  smtpPass: { type: String },
  smtpSecure: { type: Boolean, default: true },
  emailSignature: { type: String },
  branding: {
    logoUrl: { type: String },
    primaryColor: { type: String, default: '#D32F2F' },
    companyName: { type: String },
    companyAddress: { type: String },
    supportEmail: { type: String },
    supportPhone: { type: String }
  },
  enabledCategories: {
    ACCOUNT: { type: Boolean, default: true },
    CUSTOMER: { type: Boolean, default: true },
    PROVIDER: { type: Boolean, default: true },
    WALLET: { type: Boolean, default: true },
    REFERRAL: { type: Boolean, default: true },
    AFFILIATE: { type: Boolean, default: true },
    MARKETING: { type: Boolean, default: false },
    LEGAL: { type: Boolean, default: true },
    ADMIN: { type: Boolean, default: true },
    SECURITY: { type: Boolean, default: true }
  },
  enabledEmails: [{ type: String }] // e.g. ["WELCOME_EMAIL", "PASSWORD_RESET"]
}, { timestamps: true });

export default mongoose.model<IEmailConfig>('EmailConfig', EmailConfigSchema);
