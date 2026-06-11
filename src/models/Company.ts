import mongoose, { Schema, Document } from 'mongoose';

export enum CompanyStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED'
}

export interface ICompany extends Document {
  name: string;
  registrationNumber: string;
  taxNumber?: string;
  countryCode: string;
  billingEmail: string;
  contactPerson: string;
  contactNumber: string;
  status: CompanyStatus;
  ownerId: mongoose.Types.ObjectId;
  documents: {
    type: string;
    url: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    uploadedAt: Date;
  }[];
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema: Schema = new Schema({
  name: { type: String, required: true },
  registrationNumber: { type: String, required: true, unique: true },
  taxNumber: { type: String },
  countryCode: { type: String, required: true },
  billingEmail: { type: String, required: true },
  contactPerson: { type: String, required: true },
  contactNumber: { type: String, required: true },
  status: { type: String, enum: Object.values(CompanyStatus), default: CompanyStatus.PENDING },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  documents: [{
    type: { type: String },
    url: { type: String },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

CompanySchema.index({ countryCode: 1 });
CompanySchema.index({ status: 1 });

export default mongoose.model<ICompany>('Company', CompanySchema);
