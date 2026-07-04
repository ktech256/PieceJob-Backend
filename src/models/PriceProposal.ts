import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceProposal extends Document {
  jobId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  amount: number;
  note?: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'EXPIRED';
  round: number;
  countryCode: string;
  createdAt: Date;
  updatedAt: Date;
}

const PriceProposalSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  note: { type: String },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'EXPIRED'], default: 'PENDING' },
  round: { type: Number, default: 1 },
  countryCode: { type: String, required: true }
}, { timestamps: true });

PriceProposalSchema.index({ jobId: 1 });
PriceProposalSchema.index({ senderId: 1, receiverId: 1 });

export default mongoose.model<IPriceProposal>('PriceProposal', PriceProposalSchema);
