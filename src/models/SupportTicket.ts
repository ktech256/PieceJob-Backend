import mongoose, { Schema, Document } from 'mongoose';

export enum TicketStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  WAITING_CUSTOMER = 'WAITING_CUSTOMER',
  WAITING_PROVIDER = 'WAITING_PROVIDER',
  ESCROW_REVIEW = 'ESCROW_REVIEW',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export enum TicketType {
  PAYMENT_DISPUTE = 'PAYMENT_DISPUTE',
  SERVICE_QUALITY = 'SERVICE_QUALITY',
  PROVIDER_BEHAVIOR = 'PROVIDER_BEHAVIOR',
  CUSTOMER_BEHAVIOR = 'CUSTOMER_BEHAVIOR',
  NO_SHOW = 'NO_SHOW',
  SCAM_SUSPICION = 'SCAM_SUSPICION',
  PROPERTY_DAMAGE = 'PROPERTY_DAMAGE',
  OTHER = 'OTHER'
}

export interface ITicketTimeline {
  status: TicketStatus;
  adminId?: mongoose.Types.ObjectId;
  action: string;
  reason?: string;
  timestamp: Date;
}

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId;
  role: 'CUSTOMER' | 'PROVIDER';
  jobId?: mongoose.Types.ObjectId;
  type: TicketType;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  internalNotes: string[];
  attachments: string[];
  countryCode: string;
  assignedTo?: mongoose.Types.ObjectId;
  assignedAt?: Date;
  timeline: ITicketTimeline[];
  messages: Array<{
    senderId: mongoose.Types.ObjectId;
    senderRole: 'USER' | 'ADMIN';
    text: string;
    attachments: string[];
    timestamp: Date;
  }>;
  escrowSettlement?: {
    customerAmount: number;
    providerAmount: number;
    decision: 'RELEASE_TO_CUSTOMER' | 'RELEASE_TO_PROVIDER' | 'SPLIT_SETTLEMENT' | 'MANUAL_OVERRIDE';
    reason: string;
    processedAt: Date;
  };
}

const SupportTicketSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['CUSTOMER', 'PROVIDER'], required: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  type: { type: String, enum: Object.values(TicketType), required: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: Object.values(TicketStatus), default: TicketStatus.OPEN },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
  internalNotes: [{ type: String }],
  attachments: [{ type: String }],
  countryCode: { type: String, required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAt: { type: Date },
  timeline: [{
    status: { type: String, enum: Object.values(TicketStatus) },
    adminId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String },
    reason: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  messages: [{
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['USER', 'ADMIN'], required: true },
    text: { type: String, required: true },
    attachments: [{ type: String }],
    timestamp: { type: Date, default: Date.now }
  }],
  escrowSettlement: {
    customerAmount: { type: Number },
    providerAmount: { type: Number },
    decision: { type: String, enum: ['RELEASE_TO_CUSTOMER', 'RELEASE_TO_PROVIDER', 'SPLIT_SETTLEMENT', 'MANUAL_OVERRIDE'] },
    reason: { type: String },
    processedAt: { type: Date }
  }
}, { timestamps: true });

SupportTicketSchema.index({ countryCode: 1, status: 1 });
SupportTicketSchema.index({ jobId: 1 });
SupportTicketSchema.index({ userId: 1 });

export default mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
