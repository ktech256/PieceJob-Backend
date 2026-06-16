import mongoose, { Schema, Document } from 'mongoose';

export interface IIntegration extends Document {
    type: 'GOOGLE_MAPS' | 'FIREBASE' | 'SMS' | 'EMAIL' | 'PUSH' | 'OTP';
    name: string;
    config: Map<string, string>;
    backupConfig: Map<string, string>;
    lastRotationDate?: Date;
    isActive: boolean;
    health: {
        status: 'ONLINE' | 'WARNING' | 'OFFLINE';
        lastSuccess?: Date;
        lastFailure?: Date;
        lastError?: string;
    };
    updatedBy: mongoose.Types.ObjectId;
}

const IntegrationSchema: Schema = new Schema({
    type: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    config: { type: Map, of: String, default: {} },
    backupConfig: { type: Map, of: String, default: {} },
    lastRotationDate: { type: Date },
    isActive: { type: Boolean, default: true },
    health: {
        status: { type: String, enum: ['ONLINE', 'WARNING', 'OFFLINE'], default: 'ONLINE' },
        lastSuccess: { type: Date },
        lastFailure: { type: Date },
        lastError: { type: String }
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model<IIntegration>('Integration', IntegrationSchema);
