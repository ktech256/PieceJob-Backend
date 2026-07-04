import mongoose, { Schema, Document } from 'mongoose';

export interface ICommissionRecord extends Document {
  jobId: mongoose.Types.ObjectId;
  providerId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  acceptedPrice: number;
  commissionPercentage: number;
  commissionAmount: number;
  bookingFeeCredit: number;
  outstandingBalance: number;
  status: 'PAID' | 'PARTIAL' | 'OUTSTANDING' | 'WAIVED' | 'SUSPENDED';
  countryCode: string;
  currency: string;
  waivedAmount?: number;
  waivedReason?: string;
  waivedBy?: mongoose.Types.ObjectId;
  timeline: {
      event: string;
      timestamp: Date;
      metadata?: any;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const CommissionRecordSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  acceptedPrice: { type: Number, required: true },
  commissionPercentage: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  bookingFeeCredit: { type: Number, required: true },
  outstandingBalance: { type: Number, required: true },
  status: { type: String, enum: ['PAID', 'PARTIAL', 'OUTSTANDING', 'WAIVED', 'SUSPENDED'], default: 'OUTSTANDING' },
  countryCode: { type: String, required: true },
  currency: { type: String, required: true },
  waivedAmount: { type: Number, default: 0 },
  waivedReason: { type: String },
  waivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  timeline: [{
      event: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      metadata: { type: Schema.Types.Mixed }
  }]
}, { timestamps: true });

CommissionRecordSchema.index({ jobId: 1 }, { unique: true });
CommissionRecordSchema.index({ providerId: 1 });
CommissionRecordSchema.index({ countryCode: 1 });

export default mongoose.model<ICommissionRecord>('CommissionRecord', CommissionRecordSchema);
