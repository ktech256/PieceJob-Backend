import mongoose, { Schema, Document } from 'mongoose';

export interface IPricing extends Document {
  serviceCode: string;
  countryCode: string;
  zoneId?: mongoose.Types.ObjectId;
  bookingFee: number;
  baseServiceFee?: number;
  surgeMultiplier: number;
  emergencySurcharge: number;
  weekendSurcharge: number;
  holidaySurcharge: number;
  currency: string;
}

const PricingSchema: Schema = new Schema({
  serviceCode: { type: String, required: true },
  countryCode: { type: String, required: true },
  zoneId: { type: Schema.Types.ObjectId, ref: 'Zone' },
  bookingFee: { type: Number, required: true },
  baseServiceFee: { type: Number },
  surgeMultiplier: { type: Number, default: 1.0 },
  emergencySurcharge: { type: Number, default: 0 },
  weekendSurcharge: { type: Number, default: 0 },
  holidaySurcharge: { type: Number, default: 0 },
  currency: { type: String, required: true }
}, { timestamps: true });

PricingSchema.index({ serviceCode: 1, countryCode: 1, zoneId: 1 }, { unique: true });

export default mongoose.model<IPricing>('Pricing', PricingSchema);
