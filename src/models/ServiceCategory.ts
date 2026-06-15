import mongoose, { Schema, Document } from 'mongoose';

export interface IServiceCategory extends Document {
  code: string; // HDS, CSS, etc.
  name: string; // Home & Domestic Services (HDS)
  description?: string;
  verificationLevel: string;
  isActive: boolean;
  isDeleted: boolean;
  sortOrder: number;
}

const ServiceCategorySchema: Schema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String },
  verificationLevel: { type: String, default: 'STANDARD' },
  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

ServiceCategorySchema.index({ code: 1 });
ServiceCategorySchema.index({ isDeleted: 1, isActive: 1 });

export default mongoose.model<IServiceCategory>('ServiceCategory', ServiceCategorySchema);
