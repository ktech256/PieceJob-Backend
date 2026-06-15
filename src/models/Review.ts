import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
  jobId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  providerId: mongoose.Types.ObjectId;
  rating: number; // 1-5
  comment?: string;
  tags?: string[];
  isVerified: boolean;
  createdAt: Date;
}

const ReviewSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  tags: [{ type: String }],
  isVerified: { type: Boolean, default: true }
}, { timestamps: true });

ReviewSchema.index({ providerId: 1, createdAt: -1 });
ReviewSchema.index({ customerId: 1 });

export default mongoose.model<IReview>('Review', ReviewSchema);
