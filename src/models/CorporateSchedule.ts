import mongoose, { Schema, Document } from 'mongoose';

export enum ScheduleFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY'
}

export interface ICorporateSchedule extends Document {
  companyId: mongoose.Types.ObjectId;
  creatorId: mongoose.Types.ObjectId;
  serviceCode: string;
  frequency: ScheduleFrequency;
  startDate: Date;
  endDate?: Date;
  lastGeneratedDate?: Date;
  nextRunDate: Date;
  jobData: {
    coordinates: number[];
    address: string;
    bookingFee: number;
    description?: string;
  };
  isActive: boolean;
  countryCode: string;
}

const CorporateScheduleSchema: Schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  serviceCode: { type: String, required: true },
  frequency: { type: String, enum: Object.values(ScheduleFrequency), required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  lastGeneratedDate: { type: Date },
  nextRunDate: { type: Date, required: true },
  jobData: {
    coordinates: { type: [Number], required: true },
    address: { type: String, required: true },
    bookingFee: { type: Number, required: true },
    description: { type: String }
  },
  isActive: { type: Boolean, default: true },
  countryCode: { type: String, required: true }
}, { timestamps: true });

CorporateScheduleSchema.index({ nextRunDate: 1, isActive: 1 });
CorporateScheduleSchema.index({ companyId: 1 });

export default mongoose.model<ICorporateSchedule>('CorporateSchedule', CorporateScheduleSchema);
