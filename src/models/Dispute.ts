import mongoose, { Schema, Document } from 'mongoose';

export enum DisputeStatus {
  OPEN = 'OPEN',
  UNDER_INVESTIGATION = 'UNDER_INVESTIGATION',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export interface IDispute extends Document {
  jobId: mongoose.Types.ObjectId;
  raisedBy: mongoose.Types.ObjectId;
  reason: string;
  description: string;
  evidenceUrls: string[];
  status: DisputeStatus;
  adminNotes?: string;
  resolution?: string;
  resolvedAt?: Date;
  countryCode: string;
}

const DisputeSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true },
  description: { type: String, required: true },
  evidenceUrls: [{ type: String }],
  status: { type: String, enum: Object.values(DisputeStatus), default: DisputeStatus.OPEN },
  adminNotes: { type: String },
  resolution: { type: String },
  resolvedAt: { type: Date },
  countryCode: { type: String, required: true }
}, { timestamps: true });

DisputeSchema.index({ countryCode: 1, status: 1 });
DisputeSchema.index({ jobId: 1 });
DisputeSchema.index({ raisedBy: 1 });
DisputeSchema.index({ createdAt: -1 });

export default mongoose.model<IDispute>('Dispute', DisputeSchema);
