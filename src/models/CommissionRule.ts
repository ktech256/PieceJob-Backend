import mongoose, { Schema, Document } from 'mongoose';
import { ProviderTier } from './Provider';

export interface ICommissionRule extends Document {
  countryCode: string;
  tier: ProviderTier;
  commissionPercentage: number;
  isActive: boolean;
}

const CommissionRuleSchema: Schema = new Schema({
  countryCode: { type: String, required: true },
  tier: { type: String, enum: Object.values(ProviderTier), required: true },
  commissionPercentage: { type: Number, required: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

CommissionRuleSchema.index({ countryCode: 1, tier: 1 }, { unique: true });

export default mongoose.model<ICommissionRule>('CommissionRule', CommissionRuleSchema);
