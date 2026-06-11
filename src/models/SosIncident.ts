import mongoose, { Schema, Document } from 'mongoose';

export enum SosStatus {
  NEW = 'NEW',
  ACTIVE = 'ACTIVE',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  INVESTIGATING = 'INVESTIGATING',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  ARCHIVED = 'ARCHIVED'
}

export interface ISosIncident extends Document {
  incidentId: string; // Format: INC-YYYYMMDD-XXXX
  userId: mongoose.Types.ObjectId;
  userType: 'CUSTOMER' | 'PROVIDER';
  jobId?: mongoose.Types.ObjectId;
  countryCode: string;
  status: SosStatus;
  location: {
    type: string;
    coordinates: number[];
  };
  assignedAdminId?: mongoose.Types.ObjectId;
  assignedSecurityOfficer?: string;
  evidencePackageId?: mongoose.Types.ObjectId;
  activatedAt: Date;
  resolvedAt?: Date;
}

const SosIncidentSchema: Schema = new Schema({
  incidentId: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userType: { type: String, enum: ['CUSTOMER', 'PROVIDER'], required: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  countryCode: { type: String, required: true },
  status: { type: String, enum: Object.values(SosStatus), default: SosStatus.NEW },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  assignedAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedSecurityOfficer: { type: String },
  evidencePackageId: { type: Schema.Types.ObjectId, ref: 'SosEvidence' },
  activatedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date }
}, { timestamps: true });

SosIncidentSchema.index({ location: '2dsphere' });
SosIncidentSchema.index({ countryCode: 1, status: 1 });

export default mongoose.model<ISosIncident>('SosIncident', SosIncidentSchema);
