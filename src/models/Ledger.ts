import mongoose, { Schema, Document } from 'mongoose';

export enum TransactionType {
  BOOKING_FEE = 'BOOKING_FEE',
  SERVICE_FEE = 'SERVICE_FEE',
  COMMISSION = 'COMMISSION',
  PAYOUT = 'PAYOUT',
  REFUND = 'REFUND',
  SURGE = 'SURGE',
  TIP = 'TIP',
  BONUS = 'BONUS',
  REFERRAL_REWARD = 'REFERRAL_REWARD',
  CREDIT_TOPUP = 'CREDIT_TOPUP'
}

export interface ILedger extends Document {
  transactionId: string;
  jobId?: mongoose.Types.ObjectId;
  fromUserId?: mongoose.Types.ObjectId; // Null for platform incoming
  toUserId?: mongoose.Types.ObjectId; // Null for platform outgoing
  amount: number;
  currency: string;
  countryCode: string;
  type: TransactionType;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  metadata?: any;
}

const LedgerSchema: Schema = new Schema({
  transactionId: { type: String, required: true, unique: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  toUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  countryCode: { type: String, required: true },
  type: { type: String, enum: Object.values(TransactionType), required: true },
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'CANCELLED'], default: 'PENDING' },
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

LedgerSchema.index({ transactionId: 1 });
LedgerSchema.index({ jobId: 1 });
LedgerSchema.index({ fromUserId: 1 });
LedgerSchema.index({ toUserId: 1 });
LedgerSchema.index({ countryCode: 1 });

export default mongoose.model<ILedger>('Ledger', LedgerSchema);
