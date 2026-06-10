import mongoose, { Schema, Document } from 'mongoose';

export interface IZone extends Document {
  name: string;
  countryCode: string;
  boundary: {
    type: string;
    coordinates: number[][][]; // Polygon
  };
  isActive: boolean;
}

const ZoneSchema: Schema = new Schema({
  name: { type: String, required: true },
  countryCode: { type: String, required: true },
  boundary: {
    type: { type: String, default: 'Polygon' },
    coordinates: { type: [[[Number]]], required: true }
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

ZoneSchema.index({ boundary: '2dsphere' });
ZoneSchema.index({ countryCode: 1 });

export default mongoose.model<IZone>('Zone', ZoneSchema);
