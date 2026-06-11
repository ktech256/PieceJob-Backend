import mongoose, { Schema, Document } from 'mongoose';

export interface ICounter extends Document {
  id: string; // e.g. "invoice_ZA", "payout_BW"
  seq: number;
}

const CounterSchema: Schema = new Schema({
  id: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});

export default mongoose.model<ICounter>('Counter', CounterSchema);
