import mongoose, { Schema, Document } from 'mongoose';

export interface IServiceFeeRecord extends Document {
  jobId: mongoose.Types.ObjectId;
  providerId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  acceptedPrice: number;
  serviceFeePercentage: number;
  serviceFeeAmount: number;
  bookingFeePaid: number;
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

const ServiceFeeRecordSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  acceptedPrice: { type: Number, required: true },
  serviceFeePercentage: { type: Number, required: true, alias: 'commissionPercentage' },
  serviceFeeAmount: { type: Number, required: true, alias: 'commissionAmount' },
  bookingFeePaid: { type: Number, required: true, alias: 'bookingFeeCredit' },
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

ServiceFeeRecordSchema.index({ jobId: 1 }, { unique: true });
ServiceFeeRecordSchema.index({ providerId: 1 });
ServiceFeeRecordSchema.index({ countryCode: 1 });

// Explicitly using 'commissionrecords' for backward compatibility
export default mongoose.model<IServiceFeeRecord>('ServiceFeeRecord', ServiceFeeRecordSchema, 'commissionrecords');
