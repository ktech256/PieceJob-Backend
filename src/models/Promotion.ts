import mongoose, { Schema, Document } from 'mongoose';

export interface IPromotion extends Document {
  title: string;
  description: string;
  imageUrl?: string;
  ctaText: string;
  deepLink?: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  priority: number;
  targetRole: 'CUSTOMER' | 'PROVIDER' | 'ALL';
  countryCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PromotionSchema: Schema = new Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String },
  ctaText: { type: String, default: 'Learn More' },
  deepLink: { type: String },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  priority: { type: Number, default: 0 },
  targetRole: { type: String, enum: ['CUSTOMER', 'PROVIDER', 'ALL'], default: 'ALL' },
  countryCode: { type: String }
}, { timestamps: true });

PromotionSchema.index({ isActive: 1, startDate: 1, endDate: 1, priority: -1 });

export default mongoose.model<IPromotion>('Promotion', PromotionSchema);
