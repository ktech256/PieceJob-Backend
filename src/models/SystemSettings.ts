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
  version: number;
}

const SystemSettingsSchema: Schema = new Schema({
  countryCode: { type: String, required: true, unique: true },
  matchingRadiusKm: { type: Number, default: 5 },
  baseBookingFee: { type: Number, default: 50 },
  platformCommissionPercent: { type: Number, default: 15 },
  surgeMultiplierMax: { type: Number, default: 2.5 },
  escrowCoolingPeriodHours: { type: Number, default: 12 },
  cancellationGraceProviderSec: { type: Number, default: 90 },
  cancellationGraceCustomerSec: { type: Number, default: 120 },
  maintenanceMode: { type: Boolean, default: false },
  sosAlertRadiusKm: { type: Number, default: 5 },
  referralRewardAmount: { type: Number, default: 10 },
  version: { type: Number, default: 1 }
}, { timestamps: true });

export default mongoose.model<ISystemSettings>('SystemSettings', SystemSettingsSchema);
