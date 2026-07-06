import mongoose, { Schema, Document } from 'mongoose';
import { ProviderTier } from './Provider';

export interface IServiceFeeRule extends Document {
  countryCode: string;
  tier: ProviderTier;
  serviceFeePercentage: number;
  isActive: boolean;
}

const ServiceFeeRuleSchema: Schema = new Schema({
  countryCode: { type: String, required: true },
  tier: { type: String, enum: Object.values(ProviderTier), required: true },
  serviceFeePercentage: { type: Number, required: true, alias: 'commissionPercentage' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

ServiceFeeRuleSchema.index({ countryCode: 1, tier: 1 }, { unique: true });

// Backward compatibility: using 'commissionrules' collection
export default mongoose.model<IServiceFeeRule>('ServiceFeeRule', ServiceFeeRuleSchema, 'commissionrules');
