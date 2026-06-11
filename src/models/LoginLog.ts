import mongoose, { Schema, Document } from 'mongoose';

export interface ILoginLog extends Document {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  ipAddress: string;
  userAgent?: string;
  countryCode: string;
  timestamp: Date;
}

const LoginLogSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  ipAddress: { type: String, required: true },
  userAgent: { type: String },
  countryCode: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

LoginLogSchema.index({ userId: 1, timestamp: -1 });

export default mongoose.model<ILoginLog>('LoginLog', LoginLogSchema);
