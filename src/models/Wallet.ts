import mongoose, { Schema, Document } from 'mongoose';

export interface IWallet extends Document {
  userId: mongoose.Types.ObjectId;
  countryCode: string;
  currency: string;
  balanceMain: number;
  balanceEscrow: number;
  balanceCredit: number;
  balanceReferral: number;
  balanceBonus: number;
  status: 'ACTIVE' | 'FROZEN' | 'LOCKED' | 'SUSPENDED';
  isFrozen: boolean;
  isLocked: boolean;
  isSuspended: boolean;
  freezeReason?: string;
  lockReason?: string;
  suspendReason?: string;
}

const WalletSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  countryCode: { type: String, required: true },
  currency: { type: String, required: true, default: 'USD' },
  balanceMain: { type: Number, default: 0 },
  balanceEscrow: { type: Number, default: 0 },
  balanceCredit: { type: Number, default: 0 },
  balanceReferral: { type: Number, default: 0 },
  balanceBonus: { type: Number, default: 0 },
  status: { type: String, enum: ['ACTIVE', 'FROZEN', 'LOCKED', 'SUSPENDED'], default: 'ACTIVE' },
  isFrozen: { type: Boolean, default: false },
  isLocked: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false },
  freezeReason: { type: String },
  lockReason: { type: String },
  suspendReason: { type: String }
}, { timestamps: true });

WalletSchema.index({ userId: 1 });
WalletSchema.index({ countryCode: 1 });

export default mongoose.model<IWallet>('Wallet', WalletSchema);
