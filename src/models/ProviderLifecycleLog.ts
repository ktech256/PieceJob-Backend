import mongoose, { Schema, Document } from 'mongoose';

export enum ProviderLifecycleState {
  REGISTERED = 'REGISTERED',
  VERIFICATION_PENDING = 'VERIFICATION_PENDING',
  VERIFIED = 'VERIFIED',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REINSTATED = 'REINSTATED'
}

export interface IProviderLifecycleLog extends Document {
  providerId: mongoose.Types.ObjectId;
  status: ProviderLifecycleState;
  previousStatus?: ProviderLifecycleState;
  changedBy?: mongoose.Types.ObjectId; // User ID of admin, or null for system
  reason?: string;
  countryCode: string;
  timestamp: Date;
}

const ProviderLifecycleLogSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  status: { type: String, enum: Object.values(ProviderLifecycleState), required: true },
  previousStatus: { type: String, enum: Object.values(ProviderLifecycleState) },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String },
  countryCode: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

ProviderLifecycleLogSchema.index({ providerId: 1, createdAt: -1 });

export default mongoose.model<IProviderLifecycleLog>('ProviderLifecycleLog', ProviderLifecycleLogSchema);
