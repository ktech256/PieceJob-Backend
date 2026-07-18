import mongoose, { Schema, Document } from 'mongoose';

export interface IProviderBadge extends Document {
  providerId: mongoose.Types.ObjectId;
  badgeCode: string;
  name: string;
  description: string;
  iconUrl: string;
  earnedAt: Date;
  metadata?: any;
}

const ProviderBadgeSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  badgeCode: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  iconUrl: { type: String, required: true },
  earnedAt: { type: Date, default: Date.now },
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

ProviderBadgeSchema.index({ providerId: 1, badgeCode: 1 }, { unique: true });

export default mongoose.model<IProviderBadge>('ProviderBadge', ProviderBadgeSchema);
