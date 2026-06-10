import mongoose, { Schema, Document } from 'mongoose';

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  PROVIDER = 'PROVIDER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN'
}

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  passwordHash: string;
  role: UserRole;
  countryCode: string; // ISO 3166-1 alpha-2
  deviceId?: string;
  isVerified: boolean;
  isBanned: boolean;
  referralCode: string;
  referredBy?: mongoose.Types.ObjectId;
  referralFraudScore: number;
  isReferralRewardClaimed: boolean;
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
  countryCode: { type: String, required: true },
  deviceId: { type: String },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  referralCode: { type: String, unique: true },
  referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  referralFraudScore: { type: Number, default: 0 },
  isReferralRewardClaimed: { type: Boolean, default: false }
}, { timestamps: true });

UserSchema.index({ countryCode: 1 });
UserSchema.index({ phoneNumber: 1, countryCode: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
