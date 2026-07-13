import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationTemplate extends Document {
  templateCode: string; // e.g. "AUTH_OTP"
  channel: 'PUSH' | 'SMS' | 'EMAIL';
  category: 'ACCOUNT' | 'CUSTOMER' | 'PROVIDER' | 'WALLET' | 'REFERRAL' | 'AFFILIATE' | 'MARKETING' | 'LEGAL' | 'ADMIN';
  language: string; // e.g. "EN"
  subject?: string; // For EMAIL
  title?: string; // For PUSH
  body: string;
  placeholders: string[]; // e.g. ["{{firstName}}", "{{otp}}"]
  countryCode: string;
  active: boolean;
  version: number;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
}

const NotificationTemplateSchema: Schema = new Schema({
  templateCode: { type: String, required: true },
  channel: { type: String, enum: ['PUSH', 'SMS', 'EMAIL'], required: true },
  category: { type: String, enum: ['ACCOUNT', 'CUSTOMER', 'PROVIDER', 'WALLET', 'REFERRAL', 'AFFILIATE', 'MARKETING', 'LEGAL', 'ADMIN'], default: 'ACCOUNT' },
  language: { type: String, default: 'EN' },
  subject: { type: String },
  title: { type: String },
  body: { type: String, required: true },
  placeholders: [{ type: String }],
  countryCode: { type: String, default: 'GLOBAL' },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

NotificationTemplateSchema.index({ templateCode: 1, channel: 1, countryCode: 1, language: 1 }, { unique: true });

export default mongoose.model<INotificationTemplate>('NotificationTemplate', NotificationTemplateSchema);
