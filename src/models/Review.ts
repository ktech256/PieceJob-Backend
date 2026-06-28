import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
  jobId: mongoose.Types.ObjectId;
  reviewerId: mongoose.Types.ObjectId;
  reviewedUserId: mongoose.Types.ObjectId;
  reviewerRole: 'CUSTOMER' | 'PROVIDER';
  rating: number; // 1-5
  comment?: string;
  tags?: string[];
  isVerified: boolean;
  createdAt: Date;
}

const ReviewSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reviewedUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerRole: { type: String, enum: ['CUSTOMER', 'PROVIDER'], required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  tags: [{ type: String }],
  isVerified: { type: Boolean, default: true }
}, { timestamps: true });

ReviewSchema.index({ jobId: 1, reviewerId: 1 }, { unique: true });
ReviewSchema.index({ reviewedUserId: 1, createdAt: -1 });

export default mongoose.model<IReview>('Review', ReviewSchema);
