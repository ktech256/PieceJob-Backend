import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  adminId: mongoose.Types.ObjectId;
  action: string;
  targetId?: string;
  targetCollection?: string;
  previousValue?: any;
  newValue?: any;
  ipAddress?: string;
}

const AuditLogSchema: Schema = new Schema({
  adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  targetId: { type: String },
  targetCollection: { type: String },
  previousValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },
  ipAddress: { type: String }
}, { timestamps: true });

AuditLogSchema.index({ adminId: 1 });
AuditLogSchema.index({ createdAt: 1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
