import mongoose, { Schema, Document } from 'mongoose';

export interface IExchangeRate extends Document {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
}

const ExchangeRateSchema: Schema = new Schema({
  fromCurrency: { type: String, required: true },
  toCurrency: { type: String, required: true },
  rate: { type: Number, required: true }
}, { timestamps: true });

ExchangeRateSchema.index({ fromCurrency: 1, toCurrency: 1 }, { unique: true });

export default mongoose.model<IExchangeRate>('ExchangeRate', ExchangeRateSchema);
