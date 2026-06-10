import mongoose, { Schema, Document } from 'mongoose';

export interface IFeatureFlag extends Document {
  key: string;
  description: string;
  isEnabledGlobal: boolean;
  enabledCountries: string[];
  disabledCountries: string[];
  enabledUserIds: mongoose.Types.ObjectId[];
  rolloutPercentage: number; // 0 to 100
}

const FeatureFlagSchema: Schema = new Schema({
  key: { type: String, required: true, unique: true },
  description: { type: String },
  isEnabledGlobal: { type: Boolean, default: false },
  enabledCountries: [{ type: String }],
  disabledCountries: [{ type: String }],
  enabledUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  rolloutPercentage: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model<IFeatureFlag>('FeatureFlag', FeatureFlagSchema);
