import mongoose, { Schema, Document } from 'mongoose';

export enum AppealStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PARTIALLY_APPROVED = 'PARTIALLY_APPROVED'
}

export interface IProviderAppeal extends Document {
  providerId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  adjustmentId?: mongoose.Types.ObjectId;
  ledgerId?: mongoose.Types.ObjectId; // For wallet deductions
  reasonCode: string;
  description: string;
  evidence: {
    photoUrls: string[];
    videoUrl?: string;
    documentUrls: string[];
  };
  gpsData?: {
    type: string;
    coordinates: number[];
  };
  status: AppealStatus;
  adminId?: mongoose.Types.ObjectId;
  adminNotes?: string;
  decisionDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProviderAppealSchema: Schema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  adjustmentId: { type: Schema.Types.ObjectId, ref: 'PerformanceAdjustment' },
  ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger' },
  reasonCode: { type: String, required: true },
  description: { type: String, required: true },
  evidence: {
    photoUrls: [{ type: String }],
    videoUrl: { type: String },
    documentUrls: [{ type: String }]
  },
  gpsData: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number] }
  },
  status: { type: String, enum: Object.values(AppealStatus), default: AppealStatus.PENDING },
  adminId: { type: Schema.Types.ObjectId, ref: 'User' },
  adminNotes: { type: String },
  decisionDate: { type: Date }
}, { timestamps: true });

ProviderAppealSchema.index({ providerId: 1, status: 1 });
ProviderAppealSchema.index({ status: 1 });

export default mongoose.model<IProviderAppeal>('ProviderAppeal', ProviderAppealSchema);
