import mongoose, { Schema, Document } from 'mongoose';

export enum JobStatus {
  DRAFT = 'DRAFT',
  REQUEST_CREATED = 'REQUEST_CREATED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  BOOKING_FEE_PAID = 'BOOKING_FEE_PAID',
  BROADCASTING = 'BROADCASTING',
  BROADCASTED = 'BROADCASTED',
  ACCEPTED = 'ACCEPTED',
  PROVIDER_ACCEPTED = 'PROVIDER_ACCEPTED',
  EN_ROUTE = 'EN_ROUTE',
  ARRIVED = 'ARRIVED',
  STARTED = 'STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  RATED = 'RATED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED',
  SCHEDULED = 'SCHEDULED',
  RESCHEDULED = 'RESCHEDULED'
}

export interface IJob extends Document {
  customerId: mongoose.Types.ObjectId;
  providerId?: mongoose.Types.ObjectId;
  serviceCode: string;
  serviceName?: string;
  status: JobStatus;
  countryCode: string;
  cityOrZoneId?: string;
  location: {
    type: string;
    coordinates: number[];
    address?: string;
  };
  pickupLocation?: {
    type: string;
    coordinates: number[];
    address?: string;
  };
  distanceTravelled?: number; // in meters
  bookingFee: number;
  serviceFee?: number;

  // Third Party Requests
  isForSomeoneElse: boolean;
  recipientName?: string;
  recipientPhone?: string;

  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  paymentReference?: string;
  escrowStatus: 'PENDING' | 'HELD' | 'ESCROW_HOLD_REVIEW' | 'RELEASED' | 'REFUNDED';
  fraudFlag?: string;
  cancellationReason?: string;
  cancelledBy?: mongoose.Types.ObjectId;
  acceptedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  scheduledAt?: Date;

  // PAGE 4.6 – SERVICE FEE LOCK & PRICING SNAPSHOT
  serviceFeeRateSnapshot?: number;
  photoSharingRequired?: boolean;
  priceNegotiationRequired?: boolean;
  pricingSnapshot?: {
      basePrice: number;
      hourlyPrice: number;
      bookingFee: number;
      taxPercentage: number;
      currencyCode: string;
      surcharges: {
          type: string;
          amount: number;
      }[];
  };

  // Structured Negotiation
  agreedPrice?: number;
  priceAcceptedAt?: Date;
  priceAcceptedBy?: mongoose.Types.ObjectId;
  priceStatus?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  negotiationRounds?: number;
  negotiationTimeline: {
      event: string;
      timestamp: Date;
      metadata?: any;
  }[];

  // Task Photos
  taskPhotosRequested?: boolean;
  taskPhotosRequestedAt?: Date;
  taskPhotosSeen?: boolean;
  taskPhotos?: string[];

  notificationsSent?: string[];
  notifiedProviderIds: mongoose.Types.ObjectId[];

  customerRated?: boolean;
  providerRated?: boolean;
  customerRatingDismissed?: boolean;
  providerRatingDismissed?: boolean;

  isTestJob: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const JobSchema: Schema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  serviceCode: { type: String, required: true },
  serviceName: { type: String },
  status: { type: String, enum: Object.values(JobStatus), default: JobStatus.DRAFT },
  countryCode: { type: String, required: true },
  cityOrZoneId: { type: String },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true },
    address: { type: String }
  },
  pickupLocation: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number] },
    address: { type: String }
  },
  distanceTravelled: { type: Number, default: 0 },
  bookingFee: { type: Number, required: true },
  serviceFee: { type: Number },
  isForSomeoneElse: { type: Boolean, default: false },
  recipientName: { type: String },
  recipientPhone: { type: String },
  paymentStatus: { type: String, enum: ['PENDING', 'PAID', 'REFUNDED'], default: 'PENDING' },
  paymentReference: { type: String },
  escrowStatus: { type: String, enum: ['PENDING', 'HELD', 'ESCROW_HOLD_REVIEW', 'RELEASED', 'REFUNDED'], default: 'PENDING' },
  fraudFlag: { type: String },
  cancellationReason: { type: String },
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  acceptedAt: { type: Date },
  arrivedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  cancelledAt: { type: Date },
  scheduledAt: { type: Date },

  // PAGE 4.6 – SERVICE FEE LOCK & PRICING SNAPSHOT
  serviceFeeRateSnapshot: { type: Number, alias: 'commissionRateSnapshot' },
  photoSharingRequired: { type: Boolean, default: false },
  priceNegotiationRequired: { type: Boolean, default: false },
  pricingSnapshot: {
      basePrice: { type: Number },
      hourlyPrice: { type: Number },
      bookingFee: { type: Number },
      taxPercentage: { type: Number },
      currencyCode: { type: String },
      surcharges: [{
          type: { type: String },
          amount: { type: Number }
      }]
  },

  // Structured Negotiation
  agreedPrice: { type: Number },
  priceAcceptedAt: { type: Date },
  priceAcceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  priceStatus: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'] },
  negotiationRounds: { type: Number, default: 0 },
  negotiationTimeline: [{
      event: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      metadata: { type: Schema.Types.Mixed }
  }],

  // Task Photos
  taskPhotosRequested: { type: Boolean, default: false },
  taskPhotosRequestedAt: { type: Date },
  taskPhotosSeen: { type: Boolean, default: false },
  taskPhotos: [{ type: String }],

  notificationsSent: { type: [String], default: [] },
  notifiedProviderIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },

  customerRated: { type: Boolean, default: false },
  providerRated: { type: Boolean, default: false },
  customerRatingDismissed: { type: Boolean, default: false },
  providerRatingDismissed: { type: Boolean, default: false },

  isTestJob: { type: Boolean, default: false },
  version: { type: Number, default: 1 }
}, { timestamps: true });

JobSchema.index({ location: '2dsphere' });
JobSchema.index({ countryCode: 1, status: 1 });
JobSchema.index({ providerId: 1, status: 1 });
JobSchema.index({ customerId: 1, status: 1 });
JobSchema.index({ createdAt: -1 });
JobSchema.index({ updatedAt: -1 });

export default mongoose.model<IJob>('Job', JobSchema);
