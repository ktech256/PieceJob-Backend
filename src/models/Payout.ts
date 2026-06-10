import mongoose, { Schema, Document } from 'mongoose';

export interface IPayout extends Document {
  providerId: mongoose.Types.ObjectId;
  totalAmount: number;
  currency: string;
  status: 'PENDING' | 'PAID';
  weekStartDate: Date;
  weekEndDate: Date;
  processedAt?: Date;
  jobIds: mongoose.Types.ObjectId[];
  countryCode: string;
  auditTrail: Array<{
    action: string;
    performedBy?: mongoose.Types.ObjectId;
    timestamp: Date;
    note?: string;
  }>;
}

const PayoutSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  totalAmount: { type: Number, required: true },
  currency: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'PAID'], default: 'PENDING' },
  weekStartDate: { type: Date, required: true },
  weekEndDate: { type: Date, required: true },
  processedAt: { type: Date },
  jobIds: [{ type: Schema.Types.ObjectId, ref: 'Job' }],
  countryCode: { type: String, required: true },
  auditTrail: [{
    action: { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    note: { type: String }
  }]
}, { timestamps: true });

PayoutSchema.index({ countryCode: 1, status: 1 });
PayoutSchema.index({ providerId: 1, weekStartDate: -1 });

export default mongoose.model<IPayout>('Payout', PayoutSchema);
