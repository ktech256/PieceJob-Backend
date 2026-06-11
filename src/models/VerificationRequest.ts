import mongoose, { Schema, Document } from 'mongoose';
import { VerificationLevel } from './Service';

export enum VerificationRequestStatus {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RESUBMITTED = 'RESUBMITTED'
}

export interface IVerificationRequest extends Document {
  providerId: mongoose.Types.ObjectId;
  countryCode: string;
  type: VerificationLevel;
  status: VerificationRequestStatus;

  // Documents submitted in this request
  documents: {
    type: string; // GOVERNMENT_ID, SELFIE, CERTIFICATE, LICENSE, TOOL_IMAGE, etc.
    url: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    rejectionReason?: string;
  }[];

  // High Vetting specific
  interview?: {
    status: 'NOT_SCHEDULED' | 'SCHEDULED' | 'COMPLETED';
    scheduledAt?: Date;
    notes?: string;
  };

  references?: {
    name: string;
    phone: string;
    relationship: string;
    status: 'PENDING' | 'VERIFIED' | 'FAILED';
  }[];

  approvalControls?: {
    officerApproved: boolean;
    officerId?: mongoose.Types.ObjectId;
    supervisorApproved: boolean;
    supervisorId?: mongoose.Types.ObjectId;
  };

  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  rejectionReason?: string;
}

const VerificationRequestSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  countryCode: { type: String, required: true },
  type: { type: String, enum: Object.values(VerificationLevel), required: true },
  status: { type: String, enum: Object.values(VerificationRequestStatus), default: VerificationRequestStatus.PENDING },

  documents: [{
    type: { type: String, required: true },
    url: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    rejectionReason: { type: String }
  }],

  interview: {
    status: { type: String, enum: ['NOT_SCHEDULED', 'SCHEDULED', 'COMPLETED'], default: 'NOT_SCHEDULED' },
    scheduledAt: { type: Date },
    notes: { type: String }
  },

  references: [{
    name: { type: String },
    phone: { type: String },
    relationship: { type: String },
    status: { type: String, enum: ['PENDING', 'VERIFIED', 'FAILED'], default: 'PENDING' }
  }],

  approvalControls: {
    officerApproved: { type: Boolean, default: false },
    officerId: { type: Schema.Types.ObjectId, ref: 'User' },
    supervisorApproved: { type: Boolean, default: false },
    supervisorId: { type: Schema.Types.ObjectId, ref: 'User' }
  },

  submittedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: { type: String }
}, { timestamps: true });

VerificationRequestSchema.index({ countryCode: 1, status: 1 });
VerificationRequestSchema.index({ providerId: 1, type: 1 });

export default mongoose.model<IVerificationRequest>('VerificationRequest', VerificationRequestSchema);
