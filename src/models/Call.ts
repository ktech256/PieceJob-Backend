import mongoose, { Schema, Document } from 'mongoose';

export enum CallStatus {
  MISSED = 'MISSED',
  REJECTED = 'REJECTED',
  ANSWERED = 'ANSWERED',
  CANCELLED = 'CANCELLED'
}

export interface ICall extends Document {
  jobId: mongoose.Types.ObjectId;
  callerId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  startTime: Date;
  endTime?: Date;
  duration?: number; // in seconds
  status: CallStatus;
}

const CallSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  callerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  duration: { type: Number },
  status: { type: String, enum: Object.values(CallStatus), default: CallStatus.MISSED }
}, { timestamps: true });

CallSchema.index({ jobId: 1 });
CallSchema.index({ callerId: 1 });
CallSchema.index({ receiverId: 1 });

export default mongoose.model<ICall>('Call', CallSchema);
