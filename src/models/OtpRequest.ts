import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpRequest extends Document {
  phoneNumber: string;
  otp: string;
  expiresAt: Date;
  isUsed: boolean;
  attempts: number;
  lastAttemptAt: Date;
}

const OtpRequestSchema: Schema = new Schema({
  phoneNumber: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isUsed: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  lastAttemptAt: { type: Date, default: Date.now }
}, { timestamps: true });

OtpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired

export default mongoose.model<IOtpRequest>('OtpRequest', OtpRequestSchema);
