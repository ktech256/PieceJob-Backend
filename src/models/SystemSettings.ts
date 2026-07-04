import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
  countryCode: string; // "GLOBAL" or ISO code
  matchingRadiusKm: number;
  baseBookingFee: number;
  platformCommissionPercent: number;
  surgeMultiplierMax: number;
  escrowCoolingPeriodHours: number;
  cancellationGraceProviderSec: number;
  cancellationGraceCustomerSec: number;
  maintenanceMode: boolean;
  sosAlertRadiusKm: number;
  referralRewardAmount: number;

  // Structured Negotiation & Commission
  maxNegotiationRounds: number;
  commissionSuspensionThreshold: number;
  autoSuspendEnabled: boolean;
  autoUnsuspendEnabled: boolean;
  voucherVendors: {
      name: string;
      code: string;
      isEnabled: boolean;
  }[];

  // PAGE 4.1 – COUNTRY PRICING
  bookingFee: number;
  platformFee: number;
  minimumCharge: number;
  calloutFee: number;
  cancellationFee: number;

  taxName: string; // e.g. "VAT"
  taxPercentage: number;
  isTaxInclusive: boolean;

  // New fields from Phase 13 gate remediation
  nightFeeEnabled: boolean;
  nightFeePercentage: number;
  nightFeeStart: string; // "22:00"
  nightFeeEnd: string;   // "05:00"
  weekendFeeEnabled: boolean;
  weekendFeePercentage: number;

  // PAGE 12: Fraud & Security
  deviceLockEnabled: boolean;

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
  baseBookingFee: { type: Number, default: 0 },
  platformCommissionPercent: { type: Number, default: 15 },
  surgeMultiplierMax: { type: Number, default: 2.5 },
  escrowCoolingPeriodHours: { type: Number, default: 12 },
  cancellationGraceProviderSec: { type: Number, default: 90 },
  cancellationGraceCustomerSec: { type: Number, default: 120 },
  maintenanceMode: { type: Boolean, default: false },
  sosAlertRadiusKm: { type: Number, default: 5 },
  referralRewardAmount: { type: Number, default: 10 },

  // Structured Negotiation & Commission
  maxNegotiationRounds: { type: Number, default: 4 },
  commissionSuspensionThreshold: { type: Number, default: 100 },
  autoSuspendEnabled: { type: Boolean, default: true },
  autoUnsuspendEnabled: { type: Boolean, default: true },
  voucherVendors: [{
      name: { type: String },
      code: { type: String },
      isEnabled: { type: Boolean, default: true }
  }],

  // PAGE 4.1 – COUNTRY PRICING
  bookingFee: { type: Number, default: 0 },
  platformFee: { type: Number, default: 0 },
  minimumCharge: { type: Number, default: 0 },
  calloutFee: { type: Number, default: 0 },
  cancellationFee: { type: Number, default: 0 },

  taxName: { type: String, default: 'VAT' },
  taxPercentage: { type: Number, default: 0 },
  isTaxInclusive: { type: Boolean, default: true },

  nightFeeEnabled: { type: Boolean, default: false },
  nightFeePercentage: { type: Number, default: 0 },
  nightFeeStart: { type: String, default: '22:00' },
  nightFeeEnd: { type: String, default: '05:00' },
  weekendFeeEnabled: { type: Boolean, default: false },
  weekendFeePercentage: { type: Number, default: 0 },

  // PAGE 12: Fraud & Security
  deviceLockEnabled: { type: Boolean, default: true },

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
