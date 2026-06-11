import mongoose, { Schema, Document } from 'mongoose';

export interface ICountry extends Document {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string;
  timezone: string; // e.g. Africa/Johannesburg
  language: string; // e.g. en
  locale: string;   // e.g. en-ZA
  flagEmoji: string; // e.g. 🇿🇦
  isActive: boolean;
  createdBy?: mongoose.Types.ObjectId;
}

const CountrySchema: Schema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  currency: { type: String, required: true },
  timezone: { type: String, required: true, default: 'UTC' },
  language: { type: String, required: true, default: 'en' },
  locale: { type: String, required: true, default: 'en-US' },
  flagEmoji: { type: String },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model<ICountry>('Country', CountrySchema);
