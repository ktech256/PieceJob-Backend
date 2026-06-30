import mongoose, { Schema, Document } from 'mongoose';

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  PROVIDER = 'PROVIDER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  COUNTRY_ADMIN = 'COUNTRY_ADMIN',
  FINANCE_ADMIN = 'FINANCE_ADMIN',
  VERIFICATION_ADMIN = 'VERIFICATION_ADMIN',
  SUPPORT_ADMIN = 'SUPPORT_ADMIN',
  READ_ONLY_ADMIN = 'READ_ONLY_ADMIN',
  CORPORATE_OWNER = 'CORPORATE_OWNER',
  CORPORATE_ADMIN = 'CORPORATE_ADMIN',
  CORPORATE_EMPLOYEE = 'CORPORATE_EMPLOYEE'
}

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  passwordHash: string;
  role: UserRole;
  companyId?: mongoose.Types.ObjectId;
  countryCode: string; // ISO 3166-1 alpha-2
  deviceId?: string;
  hardwareId?: string;
  fcmToken?: string;
  isVerified: boolean;
  isBanned: boolean;
  referralCode: string;
  referredBy?: mongoose.Types.ObjectId;
  referralFraudScore: number;
  isReferralRewardClaimed: boolean;
  isTestUser: boolean;
  gender?: string;
  dob?: string;
  idOrPassportNumber?: string;
  profilePhoto?: string;
  city?: string;
  province?: string;
  address?: string;
  addresses?: {
    label: string; // Home, Work, Other
    address: string;
    coordinates: number[];
    isDefault: boolean;
  }[];
  savedLocations?: {
    name: string;
    address: string;
    coordinates: number[];
  }[];
  paymentMethods?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    token: string;
    isDefault: boolean;
  }[];
  pendingAddress?: {
    province: string;
    city: string;
    address: string;
    proofOfResidenceUrl: string;
    submittedAt: Date;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  };
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  emergencyContacts?: {
    name: string;
    phone: string;
    relationship: string;
  }[];
  language?: string;
  country?: string;
  privacySettings?: {
    profileVisibility: 'PUBLIC' | 'PRIVATE';
    shareLocation: boolean;
    dataSharing: boolean;
    marketingPreferences: boolean;
  };
  subscription?: {
    plan: 'BASIC' | 'PLUS';
    status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED';
    startDate: Date;
    expiryDate: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: Object.values(UserRole), default: UserRole.CUSTOMER },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
  countryCode: { type: String, required: true },
  deviceId: { type: String },
  hardwareId: { type: String },
  fcmToken: { type: String },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  isTestUser: { type: Boolean, default: false },
  gender: { type: String },
  dob: { type: String },
  idOrPassportNumber: { type: String },
  profilePhoto: { type: String },
  city: { type: String },
  province: { type: String },
  address: { type: String },
  addresses: [{
    label: { type: String },
    address: { type: String },
    coordinates: { type: [Number] },
    isDefault: { type: Boolean, default: false }
  }],
  savedLocations: [{
    name: { type: String },
    address: { type: String },
    coordinates: { type: [Number] }
  }],
  paymentMethods: [{
    brand: { type: String },
    last4: { type: String },
    expMonth: { type: Number },
    expYear: { type: Number },
    token: { type: String },
    isDefault: { type: Boolean, default: false }
  }],
  pendingAddress: {
    province: { type: String },
    city: { type: String },
    address: { type: String },
    proofOfResidenceUrl: { type: String },
    submittedAt: { type: Date },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'] }
  },
  emergencyContact: {
    name: { type: String },
    phone: { type: String },
    relationship: { type: String }
  },
  emergencyContacts: [{
    name: { type: String },
    phone: { type: String },
    relationship: { type: String }
  }],
  language: { type: String, default: 'en' },
  country: { type: String },
  privacySettings: {
    profileVisibility: { type: String, enum: ['PUBLIC', 'PRIVATE'], default: 'PUBLIC' },
    shareLocation: { type: Boolean, default: true },
    dataSharing: { type: Boolean, default: true },
    marketingPreferences: { type: Boolean, default: true }
  },
  subscription: {
    plan: { type: String, enum: ['BASIC', 'PLUS'], default: 'BASIC' },
    status: { type: String, enum: ['ACTIVE', 'CANCELLED', 'EXPIRED'], default: 'ACTIVE' },
    startDate: { type: Date },
    expiryDate: { type: Date }
  },
  referralCode: { type: String, unique: true },
  referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  referralFraudScore: { type: Number, default: 0 },
  isReferralRewardClaimed: { type: Boolean, default: false }
}, { timestamps: true });

UserSchema.index({ countryCode: 1 });
UserSchema.index({ phoneNumber: 1, countryCode: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
