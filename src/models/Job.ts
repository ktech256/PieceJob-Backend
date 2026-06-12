import mongoose, { Schema, Document } from 'mongoose';

export enum JobStatus {
  DRAFT = 'DRAFT',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  BROADCASTED = 'BROADCASTED',
  ACCEPTED = 'ACCEPTED',
  ARRIVED = 'ARRIVED',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  RATED = 'RATED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED'
}

export interface IJob extends Document {
  customerId: mongoose.Types.ObjectId;
  providerId?: mongoose.Types.ObjectId;
  serviceCode: string;
  status: JobStatus;
  countryCode: string;
  cityOrZoneId?: string;
  location: {
    type: string;
    coordinates: number[];
    address?: string;
  };
  bookingFee: number;
  serviceFee?: number;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  escrowStatus: 'PENDING' | 'HELD' | 'ESCROW_HOLD_REVIEW' | 'RELEASED' | 'REFUNDED';
  fraudFlag?: string;
  cancellationReason?: string;
  cancelledBy?: mongoose.Types.ObjectId;
  acceptedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;

  // PAGE 4.6 – COMMISSION LOCK & PRICING SNAPSHOT
  commissionRateSnapshot?: number;
  pricingSnapshot?: {
      basePrice: number;
      hourlyPrice: number;
      bookingFee: number;
      taxPercentage: number;
      surcharges: {
          type: string;
          amount: number;
      }[];
  };

  isTestJob: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const JobSchema: Schema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  serviceCode: { type: String, required: true },
  status: { type: String, enum: Object.values(JobStatus), default: JobStatus.DRAFT },
  countryCode: { type: String, required: true },
  cityOrZoneId: { type: String },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true },
    address: { type: String }
  },
  bookingFee: { type: Number, required: true },
  serviceFee: { type: Number },
  paymentStatus: { type: String, enum: ['PENDING', 'PAID', 'REFUNDED'], default: 'PENDING' },
  escrowStatus: { type: String, enum: ['PENDING', 'HELD', 'ESCROW_HOLD_REVIEW', 'RELEASED', 'REFUNDED'], default: 'PENDING' },
  fraudFlag: { type: String },
  cancellationReason: { type: String },
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  acceptedAt: { type: Date },
  arrivedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },

  // PAGE 4.6 – COMMISSION LOCK & PRICING SNAPSHOT
  commissionRateSnapshot: { type: Number },
  pricingSnapshot: {
      basePrice: { type: Number },
      hourlyPrice: { type: Number },
      bookingFee: { type: Number },
      taxPercentage: { type: Number },
      surcharges: [{
          type: { type: String },
          amount: { type: Number }
      }]
  },

  isTestJob: { type: Boolean, default: false },
  version: { type: Number, default: 1 }
}, { timestamps: true });

JobSchema.index({ location: '2dsphere' });
JobSchema.index({ countryCode: 1, status: 1 });
JobSchema.index({ providerId: 1, status: 1 });

export default mongoose.model<IJob>('Job', JobSchema);
