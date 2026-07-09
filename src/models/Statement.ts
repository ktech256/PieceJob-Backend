import mongoose, { Schema, Document } from 'mongoose';

export enum StatementType {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY'
}

export interface IStatement extends Document {
  userId: mongoose.Types.ObjectId; // User or Provider
  userType: 'CUSTOMER' | 'PROVIDER';
  type: StatementType;
  periodStart: Date;
  periodEnd: Date;
  summary: {
    grossEarnings?: number;
    platformServiceFee?: number;
    netEarnings?: number;
    totalExpenditure?: number;
    jobCount: number;
    payoutCount?: number;
  };
  details: Array<{
    date: Date;
    jobId?: mongoose.Types.ObjectId;
    transactionId: string;
    description: string;
    amount: number;
    type: string;
  }>;
  pdfUrl?: string;
  countryCode: string;
  createdAt: Date;
  updatedAt: Date;
}

const StatementSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userType: { type: String, enum: ['CUSTOMER', 'PROVIDER'], required: true },
  type: { type: String, enum: Object.values(StatementType), required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  summary: {
    grossEarnings: Number,
    platformServiceFee: { type: Number, alias: 'platformCommission' },
    netEarnings: Number,
    totalExpenditure: Number,
    jobCount: { type: Number, default: 0 },
    payoutCount: { type: Number, default: 0 }
  },
  details: [{
    date: { type: Date, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    transactionId: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, required: true }
  }],
  pdfUrl: { type: String },
  countryCode: { type: String, required: true }
}, { timestamps: true });

StatementSchema.index({ userId: 1, type: 1, periodStart: -1 });

export default mongoose.model<IStatement>('Statement', StatementSchema);
