import mongoose, { Schema, Document } from 'mongoose';

export enum PerformanceScoreType {
  RELIABILITY = 'RELIABILITY',
  CANCELLATION = 'CANCELLATION',
  ACCEPTANCE = 'ACCEPTANCE',
  ON_TIME_ARRIVAL = 'ON_TIME_ARRIVAL',
  CUSTOMER_RATING = 'CUSTOMER_RATING'
}

export interface IPerformanceAdjustment extends Document {
  providerId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  scoreType: PerformanceScoreType;
  oldScore: number;
  newScore: number;
  adjustmentPoints: number;
  reason: string;
  jobId?: mongoose.Types.ObjectId;
  disputeId?: mongoose.Types.ObjectId;
  metadata?: any;
  createdAt: Date;
}

const PerformanceAdjustmentSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  scoreType: { type: String, enum: Object.values(PerformanceScoreType), required: true },
  oldScore: { type: Number, required: true },
  newScore: { type: Number, required: true },
  adjustmentPoints: { type: Number, required: true },
  reason: { type: String, required: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  disputeId: { type: Schema.Types.ObjectId, ref: 'Dispute' },
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

PerformanceAdjustmentSchema.index({ providerId: 1, createdAt: -1 });
PerformanceAdjustmentSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<IPerformanceAdjustment>('PerformanceAdjustment', PerformanceAdjustmentSchema);
