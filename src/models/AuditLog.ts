import mongoose, { Schema, Document } from 'mongoose';

export enum AuditType {
  ADMIN_ACTION = 'ADMIN_ACTION',
  FINANCIAL_MUTATION = 'FINANCIAL_MUTATION',
  USER_MODIFICATION = 'USER_MODIFICATION',
  CHAT_ACCESS = 'CHAT_ACCESS'
}

export interface IAuditLog extends Document {
  auditId: string;
  countryCode: string;
  auditType: AuditType;

  // Actor Info
  adminId?: mongoose.Types.ObjectId;
  adminRole?: string;
  userId?: mongoose.Types.ObjectId; // If user-triggered (e.g. self-profile change)

  // Entity Info
  entityType?: string; // "Provider", "User", "Pricing", "Wallet", etc.
  entityId?: string;

  // State Change
  action: string; // e.g. "VERIFY_PROVIDER", "WALLET_CREDIT", "PASSWORD_RESET"
  beforeState?: any;
  afterState?: any;

  // Financial specifics (Optional)
  financialInfo?: {
      transactionId?: string;
      jobId?: mongoose.Types.ObjectId;
      walletType?: string;
      mutationType?: 'CREDIT' | 'DEBIT';
      amountBase: number;
      amountUSD: number;
      currency: string;
      previousBalance: number;
      newBalance: number;
  };

  // Chat specifics (Optional)
  chatInfo?: {
      jobId: mongoose.Types.ObjectId;
      chatId?: string;
      accessReason: string;
      userViewed: string; // "Customer" | "Provider" | "Both"
  };

  // Metadata
  ipAddress?: string;
  deviceInfo?: string;
  systemSource: string; // "API", "CRON", "ADMIN_DASHBOARD"
  timestampUTC: Date;
  createdAt: Date;
}

const AuditLogSchema: Schema = new Schema({
  auditId: { type: String, required: true, unique: true },
  countryCode: { type: String, required: true },
  auditType: { type: String, enum: Object.values(AuditType), required: true },

  adminId: { type: Schema.Types.ObjectId, ref: 'User' },
  adminRole: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },

  entityType: { type: String },
  entityId: { type: String },

  action: { type: String, required: true },
  beforeState: { type: Schema.Types.Mixed },
  afterState: { type: Schema.Types.Mixed },

  financialInfo: {
      transactionId: { type: String },
      jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
      walletType: { type: String },
      mutationType: { type: String, enum: ['CREDIT', 'DEBIT'] },
      amountBase: { type: Number },
      amountUSD: { type: Number },
      currency: { type: String },
      previousBalance: { type: Number },
      newBalance: { type: Number }
  },

  chatInfo: {
      jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
      chatId: { type: String },
      accessReason: { type: String },
      userViewed: { type: String }
  },

  ipAddress: { type: String },
  deviceInfo: { type: String },
  systemSource: { type: String, required: true },
  timestampUTC: { type: Date, default: Date.now }
}, { timestamps: true });

// Performance Indexes
AuditLogSchema.index({ countryCode: 1 });
AuditLogSchema.index({ timestampUTC: -1 });
AuditLogSchema.index({ auditType: 1 });
AuditLogSchema.index({ adminId: 1 });
AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ "financialInfo.transactionId": 1 });
AuditLogSchema.index({ "financialInfo.jobId": 1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
