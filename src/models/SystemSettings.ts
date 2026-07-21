import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
  countryCode: string; // "GLOBAL" or ISO code
  matchingRadiusKm: number;
  baseBookingFee: number;
  platformServiceFeePercent: number;
  surgeMultiplierMax: number;
  escrowCoolingPeriodHours: number;
  cancellationGraceProviderSec: number;
  cancellationGraceCustomerSec: number;
  maintenanceMode: boolean;
  sosAlertRadiusKm: number;
  referralRewardAmount: number;
  referralRewardCustomer: number;
  referralRewardProvider: number;
  referralRewardBusiness: number;

  // PAGE 15: REFERRAL MANAGEMENT CENTRE
  referralProgramEnabled: boolean;
  referralRewardType: 'CASH' | 'WALLET_CREDIT' | 'REFERRAL_BALANCE';
  referralMinCompletedJobs: number;
  referralMaxRewardsPerUser: number;
  referralRewardDelayDays: number;
  referralExpiryDays: number; // 0 = Never
  referralBaseUrl: string;
  referralQrBranding: 'PIECEJOB' | 'WORKSPACE' | 'NONE';

  // Fraud Protection Settings
  referralFraudDuplicatePhoneEnabled: boolean;
  referralFraudDuplicateEmailEnabled: boolean;
  referralFraudHardwareDetectionEnabled: boolean;
  referralFraudCircularDetectionEnabled: boolean;

  // Structured Negotiation & Service Fee
  maxNegotiationRounds: number;
  serviceFeeSuspensionThreshold: number;
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

  isEscrowEnabled: boolean;

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
  platformServiceFeePercent: { type: Number, default: 15, alias: 'platformCommissionPercent' },
  surgeMultiplierMax: { type: Number, default: 2.5 },
  escrowCoolingPeriodHours: { type: Number, default: 12 },
  cancellationGraceProviderSec: { type: Number, default: 90 },
  cancellationGraceCustomerSec: { type: Number, default: 120 },
  maintenanceMode: { type: Boolean, default: false },
  sosAlertRadiusKm: { type: Number, default: 5 },
  referralRewardAmount: { type: Number, default: 10 },
  referralRewardCustomer: { type: Number, default: 10 },
  referralRewardProvider: { type: Number, default: 20 },
  referralRewardBusiness: { type: Number, default: 50 },

  // PAGE 15: REFERRAL MANAGEMENT CENTRE
  referralProgramEnabled: { type: Boolean, default: true },
  referralRewardType: { type: String, enum: ['CASH', 'WALLET_CREDIT', 'REFERRAL_BALANCE'], default: 'REFERRAL_BALANCE' },
  referralMinCompletedJobs: { type: Number, default: 1 },
  referralMaxRewardsPerUser: { type: Number, default: 5 },
  referralRewardDelayDays: { type: Number, default: 0 },
  referralExpiryDays: { type: Number, default: 0 }, // 0 = Never
  referralBaseUrl: {
      type: String,
      default: 'https://piecejob.co/r/',
      set: (v: string) => v.endsWith('/') ? v : `${v}/`
  },
  referralQrBranding: { type: String, enum: ['PIECEJOB', 'WORKSPACE', 'NONE'], default: 'PIECEJOB' },

  referralFraudDuplicatePhoneEnabled: { type: Boolean, default: true },
  referralFraudDuplicateEmailEnabled: { type: Boolean, default: true },
  referralFraudHardwareDetectionEnabled: { type: Boolean, default: true },
  referralFraudCircularDetectionEnabled: { type: Boolean, default: true },

  // Structured Negotiation & Service Fee
  maxNegotiationRounds: { type: Number, default: 4 },
  serviceFeeSuspensionThreshold: { type: Number, default: 100, alias: 'commissionSuspensionThreshold' },
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

  isEscrowEnabled: { type: Boolean, default: false },

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
