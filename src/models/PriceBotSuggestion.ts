import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceBotSuggestion extends Document {
  countryCode: string;
  zoneId?: mongoose.Types.ObjectId;
  serviceCode?: string;
  suggestedMultiplier: number;
  reason: string;
  demandLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  supplyLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  adminId?: mongoose.Types.ObjectId;
}

const PriceBotSuggestionSchema: Schema = new Schema({
  countryCode: { type: String, required: true },
  zoneId: { type: Schema.Types.ObjectId, ref: 'Zone' },
  serviceCode: { type: String },
  suggestedMultiplier: { type: Number, required: true },
  reason: { type: String, required: true },
  demandLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
  supplyLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'], default: 'PENDING' },
  adminId: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model<IPriceBotSuggestion>('PriceBotSuggestion', PriceBotSuggestionSchema);
