import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
  countryCode: string; // "GLOBAL" or ISO code
  matchingRadiusKm: number;
  baseBookingFee: number;
  platformCommissionPercent: number;
  currency: string;
  surgeMultiplierMax: number;
  escrowCoolingPeriodHours: number;
  cancellationGraceProviderSec: number;
  cancellationGraceCustomerSec: number;
  maintenanceMode: boolean;
  sosAlertRadiusKm: number;
  referralRewardAmount: number;

  // New fields from Phase 13 gate remediation
  nightFeeEnabled: boolean;
  nightFeePercentage: number;
  weekendFeeEnabled: boolean;
  weekendFeePercentage: number;

  integrations: {
      paymentGateway?: string;
      paymentPublicKey?: string;
      paymentSecretKey?: string;
      paymentWebhookSecret?: string;
      googleMapsKey?: string;
      smsProvider?: string;
      smsApiKey?: string;
      ikhokhaEntityId?: string;
      ikhokhaApiKey?: string;
      ikhokhaSecretKey?: string;
  };

  platformName?: string;
  supportEmail?: string;
  supportPhone?: string;
  adminNote?: string;

  version: number;
}

const SystemSettingsSchema: Schema = new Schema({
  countryCode: { type: String, required: true, unique: true },
  matchingRadiusKm: { type: Number, default: 5 },
  baseBookingFee: { type: Number, default: 50 },
  platformCommissionPercent: { type: Number, default: 15 },
  currency: { type: String, default: 'USD' },
  surgeMultiplierMax: { type: Number, default: 2.5 },
  escrowCoolingPeriodHours: { type: Number, default: 12 },
  cancellationGraceProviderSec: { type: Number, default: 90 },
  cancellationGraceCustomerSec: { type: Number, default: 120 },
  maintenanceMode: { type: Boolean, default: false },
  sosAlertRadiusKm: { type: Number, default: 5 },
  referralRewardAmount: { type: Number, default: 10 },

  nightFeeEnabled: { type: Boolean, default: false },
  nightFeePercentage: { type: Number, default: 0 },
  weekendFeeEnabled: { type: Boolean, default: false },
  weekendFeePercentage: { type: Number, default: 0 },

  integrations: {
      paymentGateway: { type: String },
      paymentPublicKey: { type: String },
      paymentSecretKey: { type: String },
      paymentWebhookSecret: { type: String },
      googleMapsKey: { type: String },
      smsProvider: { type: String },
      smsApiKey: { type: String },
      ikhokhaEntityId: { type: String },
      ikhokhaApiKey: { type: String },
      ikhokhaSecretKey: { type: String },
  },

  platformName: { type: String },
  supportEmail: { type: String },
  supportPhone: { type: String },
  adminNote: { type: String },

  version: { type: Number, default: 1 }
}, { timestamps: true });

export default mongoose.model<ISystemSettings>('SystemSettings', SystemSettingsSchema);
