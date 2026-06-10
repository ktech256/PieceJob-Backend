import mongoose, { Schema, Document } from 'mongoose';

export enum AlertStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
  FALSE_ALARM = 'FALSE_ALARM'
}

export interface IPanicAlert extends Document {
  userId: mongoose.Types.ObjectId;
  jobId?: mongoose.Types.ObjectId;
  location: {
    type: string;
    coordinates: number[];
  };
  status: AlertStatus;
  evidenceUrls: string[];
  resolvedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const PanicAlertSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  status: { type: String, enum: Object.values(AlertStatus), default: AlertStatus.ACTIVE },
  evidenceUrls: [{ type: String }],
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

PanicAlertSchema.index({ location: '2dsphere' });

export default mongoose.model<IPanicAlert>('PanicAlert', PanicAlertSchema);
