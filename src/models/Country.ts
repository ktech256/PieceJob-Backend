import mongoose, { Schema, Document } from 'mongoose';

export interface ICountry extends Document {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string;
  isActive: boolean;
}

const CountrySchema: Schema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  currency: { type: String, required: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model<ICountry>('Country', CountrySchema);
