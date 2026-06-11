import mongoose, { Schema, Document } from 'mongoose';
import { ProviderTier } from './Provider';

export interface IProviderTierHistory extends Document {
  providerId: mongoose.Types.ObjectId;
  oldTier: ProviderTier;
  newTier: ProviderTier;
  reason: string; // "Performance Upgrade", "Manual Adjustment", etc.
  countryCode: string;
  timestamp: Date;
}

const ProviderTierHistorySchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  oldTier: { type: String, enum: Object.values(ProviderTier), required: true },
  newTier: { type: String, enum: Object.values(ProviderTier), required: true },
  reason: { type: String, required: true },
  countryCode: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

ProviderTierHistorySchema.index({ providerId: 1, createdAt: -1 });

export default mongoose.model<IProviderTierHistory>('ProviderTierHistory', ProviderTierHistorySchema);
