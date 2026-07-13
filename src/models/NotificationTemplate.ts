import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationTemplate extends Document {
  templateCode: string; // e.g. "AUTH_OTP"
  channel: 'PUSH' | 'SMS' | 'EMAIL';
  category: 'ACCOUNT' | 'CUSTOMER' | 'PROVIDER' | 'WALLET' | 'REFERRAL' | 'AFFILIATE' | 'MARKETING' | 'LEGAL' | 'ADMIN' | 'SECURITY';
  description?: string;
  trigger?: string;
  recipient?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  language: string; // e.g. "EN"
  subject?: string; // For EMAIL
  title?: string; // For PUSH
  body: string; // HTML for EMAIL
  plainTextBody?: string;
  placeholders: string[]; // e.g. ["firstName", "otp"]
  attachmentSupport: boolean;
  pdfSupport: boolean;
  retryCount: number;
  enabledByDefault: boolean;
  isFutureReady: boolean;
  countryCode: string;
  active: boolean;
  version: number;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
}

const NotificationTemplateSchema: Schema = new Schema({
  templateCode: { type: String, required: true },
  channel: { type: String, enum: ['PUSH', 'SMS', 'EMAIL'], required: true },
  category: { type: String, enum: ['ACCOUNT', 'CUSTOMER', 'PROVIDER', 'WALLET', 'REFERRAL', 'AFFILIATE', 'MARKETING', 'LEGAL', 'ADMIN', 'SECURITY'], default: 'ACCOUNT' },
  description: { type: String },
  trigger: { type: String },
  recipient: { type: String },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' },
  language: { type: String, default: 'EN' },
  subject: { type: String },
  title: { type: String },
  body: { type: String, required: true },
  plainTextBody: { type: String },
  placeholders: [{ type: String }],
  attachmentSupport: { type: Boolean, default: false },
  pdfSupport: { type: Boolean, default: false },
  retryCount: { type: Number, default: 3 },
  enabledByDefault: { type: Boolean, default: true },
  isFutureReady: { type: Boolean, default: false },
  countryCode: { type: String, default: 'GLOBAL' },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

NotificationTemplateSchema.index({ templateCode: 1, channel: 1, countryCode: 1, language: 1 }, { unique: true });

export default mongoose.model<INotificationTemplate>('NotificationTemplate', NotificationTemplateSchema);
