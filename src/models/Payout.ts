import mongoose, { Schema, Document } from 'mongoose';

export enum PayoutStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  REVERSED = 'REVERSED'
}

export interface IPayout extends Document {
  providerId: mongoose.Types.ObjectId;
  totalAmount: number;
  currency: string;
  status: PayoutStatus;
  weekStartDate: Date;
  weekEndDate: Date;
  processedAt?: Date;
  paidAt?: Date;
  reversedAt?: Date;
  jobIds: mongoose.Types.ObjectId[];
  countryCode: string;
  batchId?: string;
  bankReference?: string;
  failureReason?: string;
  auditTrail: Array<{
    action: string;
    performedBy?: mongoose.Types.ObjectId;
    timestamp: Date;
    note?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const PayoutSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  totalAmount: { type: Number, required: true },
  currency: { type: String, required: true },
  status: { type: String, enum: Object.values(PayoutStatus), default: PayoutStatus.PENDING },
  weekStartDate: { type: Date, required: true },
  weekEndDate: { type: Date, required: true },
  processedAt: { type: Date },
  paidAt: { type: Date },
  reversedAt: { type: Date },
  jobIds: [{ type: Schema.Types.ObjectId, ref: 'Job' }],
  countryCode: { type: String, required: true },
  batchId: { type: String },
  bankReference: { type: String },
  failureReason: { type: String },
  auditTrail: [{
    action: { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    note: { type: String }
  }]
}, { timestamps: true });

PayoutSchema.index({ countryCode: 1, status: 1 });
PayoutSchema.index({ providerId: 1, weekStartDate: -1 });
PayoutSchema.index({ batchId: 1 });

export default mongoose.model<IPayout>('Payout', PayoutSchema);
