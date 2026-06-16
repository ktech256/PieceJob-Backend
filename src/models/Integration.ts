import mongoose, { Schema, Document } from 'mongoose';

export interface IIntegration extends Document {
    type: 'GOOGLE_MAPS' | 'FIREBASE' | 'SMS' | 'EMAIL' | 'PUSH' | 'OTP';
    name: string;
    config: Map<string, string>;
    isActive: boolean;
    updatedBy: mongoose.Types.ObjectId;
}

const IntegrationSchema: Schema = new Schema({
    type: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    config: { type: Map, of: String, default: {} },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model<IIntegration>('Integration', IntegrationSchema);
