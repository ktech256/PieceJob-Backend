import mongoose, { Schema, Document } from 'mongoose';

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
  gender: 'M' | 'W' | 'B';
  dob: Date;
  nationalityType: 'Citizen' | 'Other';
  idOrPassportNumber: string;
  servicesOffered: string[];
  verificationStatus: VerificationStatus;
  tier: ProviderTier;
  isOnline: boolean;
  lastHeartbeat?: Date;
  ratingAvg: number;
  jobsCompleted: number;
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
  gender: { type: String, enum: ['M', 'W', 'B'], required: true },
  dob: { type: Date, required: true },
  nationalityType: { type: String, enum: ['Citizen', 'Other'], required: true },
  idOrPassportNumber: { type: String, required: true },
  servicesOffered: [{ type: String }],
  verificationStatus: { type: String, enum: Object.values(VerificationStatus), default: VerificationStatus.PENDING },
  tier: { type: String, enum: Object.values(ProviderTier), default: ProviderTier.BRONZE },
  isOnline: { type: Boolean, default: false },
  lastHeartbeat: { type: Date },
  ratingAvg: { type: Number, default: 0 },
  jobsCompleted: { type: Number, default: 0 },
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
ProviderSchema.index({ isOnline: 1, servicesOffered: 1 });

export default mongoose.model<IProvider>('Provider', ProviderSchema);
