import mongoose, { Schema, Document } from 'mongoose';

export enum PricingLevel {
    COUNTRY = 'COUNTRY',
    ZONE = 'ZONE',
    SERVICE = 'SERVICE'
}

export interface IPricingRule extends Document {
  name: string;
  level: PricingLevel;
  serviceCode?: string; // If SERVICE level
  countryCode: string;
  zoneId?: mongoose.Types.ObjectId; // If ZONE level

  // Pricing Components
  basePrice: number;
  hourlyPrice: number;
  emergencyPriceMultiplier: number; // e.g. 1.5 for 50% increase
  weekendPriceMultiplier: number;
  holidayPriceMultiplier: number;
  nightPriceMultiplier: number;

  cancellationFee: number;
  travelFeePerKm: number;

  // Dynamic overrides
  surgeMultiplier: number;

  isActive: boolean;
  priority: number; // Higher priority wins if multiple rules apply
}

const PricingRuleSchema: Schema = new Schema({
  name: { type: String, required: true },
  level: { type: String, enum: Object.values(PricingLevel), required: true },
  serviceCode: { type: String },
  countryCode: { type: String, required: true },
  zoneId: { type: Schema.Types.ObjectId, ref: 'Zone' },

  basePrice: { type: Number, default: 0 },
  hourlyPrice: { type: Number, default: 0 },
  emergencyPriceMultiplier: { type: Number, default: 1.0 },
  weekendPriceMultiplier: { type: Number, default: 1.0 },
  holidayPriceMultiplier: { type: Number, default: 1.0 },
  nightPriceMultiplier: { type: Number, default: 1.0 },

  cancellationFee: { type: Number, default: 0 },
  travelFeePerKm: { type: Number, default: 0 },

  surgeMultiplier: { type: Number, default: 1.0 },

  isActive: { type: Boolean, default: true },
  priority: { type: Number, default: 0 }
}, { timestamps: true });

PricingRuleSchema.index({ countryCode: 1, level: 1, serviceCode: 1, zoneId: 1 });

export default mongoose.model<IPricingRule>('PricingRule', PricingRuleSchema);
