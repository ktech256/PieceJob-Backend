import mongoose, { Schema, Document } from 'mongoose';

export interface IProviderPerformance extends Document {
  providerId: mongoose.Types.ObjectId;
  acceptanceRate: number;
  completionRate: number;
  arrivalRate: number;
  complaintRate: number;
  ratingAvg: number;
  periodStart: Date;
  periodEnd: Date;
  countryCode: string;
}

const ProviderPerformanceSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  acceptanceRate: { type: Number, default: 0 },
  completionRate: { type: Number, default: 0 },
  arrivalRate: { type: Number, default: 0 },
  complaintRate: { type: Number, default: 0 },
  ratingAvg: { type: Number, default: 0 },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  countryCode: { type: String, required: true }
}, { timestamps: true });

ProviderPerformanceSchema.index({ providerId: 1, createdAt: -1 });

export default mongoose.model<IProviderPerformance>('ProviderPerformance', ProviderPerformanceSchema);
