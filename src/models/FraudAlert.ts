import mongoose, { Schema, Document } from 'mongoose';

export enum FraudRiskType {
    FAKE_COMPLETION = 'FAKE_COMPLETION',
    CUSTOMER_CANCELLATION_ABUSE = 'CUSTOMER_CANCELLATION_ABUSE',
    PROVIDER_CANCELLATION_ABUSE = 'PROVIDER_CANCELLATION_ABUSE',
    GPS_INTEGRITY = 'GPS_INTEGRITY',
    MOCK_GPS = 'MOCK_GPS',
    IMPOSSIBLE_MOVEMENT = 'IMPOSSIBLE_MOVEMENT',
    MULTI_ACCOUNT = 'MULTI_ACCOUNT',
    REFERRAL_ABUSE = 'REFERRAL_ABUSE',
    QUALICHECK_ABUSE = 'QUALICHECK_ABUSE',
    QUALICHECK_THREAT = 'QUALICHECK_THREAT'
}

export enum FraudStatus {
    PENDING = 'PENDING',
    UNDER_REVIEW = 'UNDER_REVIEW',
    APPROVED = 'APPROVED', // Confirmed Fraud
    REJECTED = 'REJECTED', // False Positive
    ESCALATED = 'ESCALATED'
}

export interface IFraudAlert extends Document {
    fraudEventId: string;
    countryCode: string;
    userId?: mongoose.Types.ObjectId;
    providerId?: mongoose.Types.ObjectId;
    jobId?: mongoose.Types.ObjectId;
    riskType: FraudRiskType;
    riskScore: number; // 0 - 100
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    status: FraudStatus;
    evidence: any;
    resolvedBy?: mongoose.Types.ObjectId;
    resolvedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const FraudAlertSchema: Schema = new Schema({
    fraudEventId: { type: String, required: true, unique: true },
    countryCode: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    providerId: { type: Schema.Types.ObjectId, ref: 'Provider' },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    riskType: { type: String, enum: Object.values(FraudRiskType), required: true },
    riskScore: { type: Number, default: 0 },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
    status: { type: String, enum: Object.values(FraudStatus), default: FraudStatus.PENDING },
    evidence: { type: Schema.Types.Mixed },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date }
}, { timestamps: true });

FraudAlertSchema.index({ countryCode: 1, status: 1 });
FraudAlertSchema.index({ riskType: 1 });
FraudAlertSchema.index({ riskScore: -1 });

export default mongoose.model<IFraudAlert>('FraudAlert', FraudAlertSchema);
