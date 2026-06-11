import mongoose, { Schema, Document } from 'mongoose';

export interface IServiceExpectedDuration extends Document {
    serviceCode: string;
    countryCode: string;
    expectedDurationMinutes: number;
    sampleSize: number;
}

const ServiceExpectedDurationSchema: Schema = new Schema({
    serviceCode: { type: String, required: true },
    countryCode: { type: String, required: true },
    expectedDurationMinutes: { type: Number, required: true, default: 60 },
    sampleSize: { type: Number, default: 0 }
}, { timestamps: true });

ServiceExpectedDurationSchema.index({ serviceCode: 1, countryCode: 1 }, { unique: true });

export default mongoose.model<IServiceExpectedDuration>('ServiceExpectedDuration', ServiceExpectedDurationSchema);
