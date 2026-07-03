import mongoose, { Schema, Document } from 'mongoose';

export enum ServiceCategory {
  HDS = 'HDS', // Home & Domestic Services
  CSS = 'CSS', // Care & Support Services
  HMS = 'HMS', // Handyman Services
  OPS = 'OPS', // Outdoor Services
  LLS = 'LLS', // Lifestyle Services
  TSS = 'TSS', // Technology Services
}

export enum GenderRule {
  MEN_ONLY = 'MEN_ONLY',
  WOMEN_ONLY = 'WOMEN_ONLY',
  BOTH = 'BOTH',
}

export enum VerificationLevel {
  STANDARD = 'STANDARD',
  PROFESSIONAL = 'PROFESSIONAL',
  TRADE = 'TRADE',
  HIGH_VETTING = 'HIGH_VETTING',
}

export interface IService extends Document {
  code: string; // e.g., HDS-01
  name: string;
  category: string; // Dynamic Category Code
  genderRule: GenderRule;
  verificationLevel: VerificationLevel;
  equipmentRequired: string[];
  isActive: boolean;
  countryCode: string; // "GLOBAL" or ISO code
  description?: string;
  icon?: string;
  bookingFee?: number;
}

const ServiceSchema: Schema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  genderRule: { type: String, enum: Object.values(GenderRule), default: GenderRule.BOTH },
  verificationLevel: { type: String, enum: Object.values(VerificationLevel), default: VerificationLevel.STANDARD },
  equipmentRequired: [{ type: String }],
  isActive: { type: Boolean, default: true },
  countryCode: { type: String, required: true, default: 'GLOBAL' },
  description: { type: String },
  icon: { type: String },
  bookingFee: { type: Number, default: 0 },
}, { timestamps: true });

ServiceSchema.index({ code: 1, countryCode: 1 }, { unique: true });
ServiceSchema.index({ category: 1 });

export default mongoose.model<IService>('Service', ServiceSchema);
