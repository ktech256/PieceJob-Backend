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
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
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
  emergencyContact: {
    name: { type: String },
    phone: { type: String },
    relationship: { type: String }
  },
  referralCode: { type: String, unique: true },
  referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  referralFraudScore: { type: Number, default: 0 },
  isReferralRewardClaimed: { type: Boolean, default: false }
}, { timestamps: true });

UserSchema.index({ countryCode: 1 });
UserSchema.index({ phoneNumber: 1, countryCode: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
