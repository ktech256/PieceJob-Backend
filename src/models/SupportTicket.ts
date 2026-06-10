import mongoose, { Schema, Document } from 'mongoose';

export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId;
  role: 'CUSTOMER' | 'PROVIDER';
  category: 'VERIFICATION' | 'PAYMENT' | 'WALLET' | 'JOB_ISSUE' | 'TECHNICAL' | 'SOS' | 'DISPUTE';
  subject: string;
  description: string;
  status: TicketStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  internalNotes: string[];
  attachments: string[];
  countryCode: string;
  assignedTo?: mongoose.Types.ObjectId;
}

const SupportTicketSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['CUSTOMER', 'PROVIDER'], required: true },
  category: { type: String, required: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: Object.values(TicketStatus), default: TicketStatus.OPEN },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
  internalNotes: [{ type: String }],
  attachments: [{ type: String }],
  countryCode: { type: String, required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

SupportTicketSchema.index({ countryCode: 1, status: 1 });
SupportTicketSchema.index({ userId: 1 });

export default mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
