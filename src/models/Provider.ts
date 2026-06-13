import mongoose, { Schema, Document } from 'mongoose';
import { VerificationLevel } from './Service';
import { ProviderLifecycleState } from './ProviderLifecycleLog';

export enum VerificationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum ProviderTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  ELITE = 'ELITE'
}

export interface IProvider extends Document {
  userId: mongoose.Types.ObjectId;
  gender: 'M' | 'F' | 'B';
  dob: Date;
  nationalityType: 'Citizen' | 'Other';
  idOrPassportNumber: string;
  servicesOffered: string[];
  verificationStatus: VerificationStatus;
  verificationLevel: VerificationLevel;
  lifecycleState: ProviderLifecycleState;
  tier: ProviderTier;
  countryCode: string;
  isOnline: boolean;
  isFeatured: boolean;
  isShadowBanned: boolean;
  shadowBannedUntil?: Date;
  hardwareId?: string;
  lastHeartbeat?: Date;
  lastGpsUpdate?: Date;
  ratingAvg: number;
  jobsCompleted: number;

  performance: {
    acceptanceRate: number;
    completionRate: number;
    arrivalRate: number;
    complaintRate: number;
    broadcastOpportunities: number;
    acceptedJobs: number;
    completedJobs: number;
    arrivedOnTimeJobs: number;
    complaintsCount: number;
  };

  location: {
    type: string;
    coordinates: number[];
  };
  suspendedUntil?: Date;
  documents: {
    type: string;
    url: string;
    status: VerificationStatus;
  }[];
}

const ProviderSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  gender: { type: String, enum: ['M', 'F', 'B'], required: true },
  dob: { type: Date, required: true },
  nationalityType: { type: String, enum: ['Citizen', 'Other'], required: true },
  idOrPassportNumber: { type: String, required: true },
  servicesOffered: [{ type: String }],
  verificationStatus: { type: String, enum: Object.values(VerificationStatus), default: VerificationStatus.PENDING },
  verificationLevel: { type: String, enum: Object.values(VerificationLevel), default: VerificationLevel.STANDARD },
  lifecycleState: { type: String, enum: Object.values(ProviderLifecycleState), default: ProviderLifecycleState.REGISTERED },
  tier: { type: String, enum: Object.values(ProviderTier), default: ProviderTier.BRONZE },
  countryCode: { type: String, required: true },
  isOnline: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  isShadowBanned: { type: Boolean, default: false },
  shadowBannedUntil: { type: Date },
  hardwareId: { type: String },
  lastHeartbeat: { type: Date },
  lastGpsUpdate: { type: Date },
  ratingAvg: { type: Number, default: 0 },
  jobsCompleted: { type: Number, default: 0 },

  performance: {
    acceptanceRate: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
    arrivalRate: { type: Number, default: 0 },
    complaintRate: { type: Number, default: 0 },
    broadcastOpportunities: { type: Number, default: 0 },
    acceptedJobs: { type: Number, default: 0 },
    completedJobs: { type: Number, default: 0 },
    arrivedOnTimeJobs: { type: Number, default: 0 },
    complaintsCount: { type: Number, default: 0 }
  },

  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], index: '2dsphere' }
  },
  suspendedUntil: { type: Date },
  documents: [{
    type: { type: String },
    url: { type: String },
    status: { type: String, enum: Object.values(VerificationStatus), default: VerificationStatus.PENDING }
  }]
}, { timestamps: true });

ProviderSchema.index({ userId: 1 });
ProviderSchema.index({ countryCode: 1 });
ProviderSchema.index({ isOnline: 1, servicesOffered: 1 });

export default mongoose.model<IProvider>('Provider', ProviderSchema);
