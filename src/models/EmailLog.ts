import mongoose, { Schema, Document } from 'mongoose';

export interface IEmailLog extends Document {
  recipient: string;
  subject: string;
  body: string;
  templateCode: string;
  countryCode: string;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'OPENED' | 'CLICKED' | 'FAILED';
  errorMessage?: string;
  attempts: number;
  metadata?: any;
  messageId?: string;
  openedAt?: Date;
  clickedAt?: Date;
  sentAt?: Date;
}

const EmailLogSchema: Schema = new Schema({
  recipient: { type: String, required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  templateCode: { type: String, required: true },
  countryCode: { type: String, required: true },
  status: { type: String, enum: ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED'], default: 'QUEUED' },
  errorMessage: { type: String },
  attempts: { type: Number, default: 0 },
  metadata: { type: Schema.Types.Mixed },
  messageId: { type: String },
  openedAt: { type: Date },
  clickedAt: { type: Date },
  sentAt: { type: Date }
}, { timestamps: true });

EmailLogSchema.index({ recipient: 1 });
EmailLogSchema.index({ templateCode: 1 });
EmailLogSchema.index({ status: 1 });
EmailLogSchema.index({ countryCode: 1 });

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);
