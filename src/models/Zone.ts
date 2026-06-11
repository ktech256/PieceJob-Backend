import mongoose, { Schema, Document } from 'mongoose';

export interface IZone extends Document {
  name: string;
  zoneCode: string;
  cityName: string;
  countryCode: string;
  boundary: {
    type: string;
    coordinates: number[][][]; // Polygon
  };
  isActive: boolean;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
}

const ZoneSchema: Schema = new Schema({
  name: { type: String, required: true },
  zoneCode: { type: String, required: true },
  cityName: { type: String, required: true },
  countryCode: { type: String, required: true },
  boundary: {
    type: { type: String, default: 'Polygon' },
    coordinates: { type: [[[Number]]], required: true }
  },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

ZoneSchema.index({ boundary: '2dsphere' });
ZoneSchema.index({ countryCode: 1 });
ZoneSchema.index({ zoneCode: 1, countryCode: 1 }, { unique: true });

export default mongoose.model<IZone>('Zone', ZoneSchema);
