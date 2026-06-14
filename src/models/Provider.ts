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
  pendingServices: string[];
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

  equipment: {
    name: string;
    category: string;
    photoUrl?: string;
    proofUrl?: string;
    isVerified: boolean;
  }[];

  certifications: {
    name: string;
    institution: string;
    certificateNumber: string;
    expiryDate?: Date;
    photoUrl: string;
    status: VerificationStatus;
  }[];

  workExperience: {
    companyName: string;
    role: string;
    startDate: Date;
    endDate?: Date;
    description?: string;
    referenceName?: string;
    referencePhone?: string;
  }[];

  bankDetails?: {
    bankName: string;
    accountHolder: string;
    accountNumberEncrypted: string;
    branchCode: string;
    accountType: string;
    bankConfirmationUrl?: string;
    isVerified: boolean;
  };

  payoutPreferences: {
    frequency: 'WEEKLY' | 'MONTHLY';
    method: 'BANK_TRANSFER' | 'WALLET_TRANSFER';
  };

  notificationSettings: {
    jobBroadcasts: boolean;
    chatMessages: boolean;
    walletAlerts: boolean;
    payoutAlerts: boolean;
    verificationUpdates: boolean;
    marketing: boolean;
    sosAlerts: boolean;
  };

  location: {
    type: string;
    coordinates: number[];
  };
  suspendedUntil?: Date;
  criminalCheckRequired: boolean;
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
  pendingServices: [{ type: String }],
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

  equipment: [{
    name: { type: String, required: true },
    category: { type: String, required: true },
    photoUrl: { type: String },
    proofUrl: { type: String },
    isVerified: { type: Boolean, default: false }
  }],

  certifications: [{
    name: { type: String, required: true },
    institution: { type: String, required: true },
    certificateNumber: { type: String, required: true },
    expiryDate: { type: Date },
    photoUrl: { type: String },
    status: { type: String, enum: Object.values(VerificationStatus), default: VerificationStatus.PENDING }
  }],

  workExperience: [{
    companyName: { type: String, required: true },
    role: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    description: { type: String },
    referenceName: { type: String },
    referencePhone: { type: String }
  }],

  bankDetails: {
    bankName: { type: String },
    accountHolder: { type: String },
    accountNumberEncrypted: { type: String },
    branchCode: { type: String },
    accountType: { type: String },
    bankConfirmationUrl: { type: String },
    isVerified: { type: Boolean, default: false }
  },

  payoutPreferences: {
    frequency: { type: String, enum: ['WEEKLY', 'MONTHLY'], default: 'WEEKLY' },
    method: { type: String, enum: ['BANK_TRANSFER', 'WALLET_TRANSFER'], default: 'BANK_TRANSFER' }
  },

  notificationSettings: {
    jobBroadcasts: { type: Boolean, default: true },
    chatMessages: { type: Boolean, default: true },
    walletAlerts: { type: Boolean, default: true },
    payoutAlerts: { type: Boolean, default: true },
    verificationUpdates: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
    sosAlerts: { type: Boolean, default: true }
  },

  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], index: '2dsphere' }
  },
  suspendedUntil: { type: Date },
  criminalCheckRequired: { type: Boolean, default: false },
  documents: [{
    type: { type: String },
    url: { type: String },
    status: { type: String, enum: Object.values(VerificationStatus), default: VerificationStatus.PENDING },
    rejectionReason: { type: String }
  }]
}, { timestamps: true });

ProviderSchema.index({ userId: 1 });
ProviderSchema.index({ countryCode: 1 });
ProviderSchema.index({ isOnline: 1, servicesOffered: 1 });

export default mongoose.model<IProvider>('Provider', ProviderSchema);
