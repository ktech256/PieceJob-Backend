import mongoose, { Schema, Document } from 'mongoose';

export interface IReferralRecord extends Document {
    referrerId: mongoose.Types.ObjectId;
    referrerType: 'USER' | 'PARTNER';
    referredId: mongoose.Types.ObjectId;
    campaignId: mongoose.Types.ObjectId;
    countryCode: string;
    jobsCompletedCount: number;
    rewardsIssuedCount: number;
    maxRewardableJobs: number;
    totalCommissionGenerated: number;
    lifetimeJobValue: number;
    lifetimePlatformRevenue: number;
    totalSpend: number;
    lifetimeEarnings: number;
    lastCompletedJobAt?: Date;
    lastCommissionDate?: Date;
    status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'SUSPENDED';
    isFraudSuspicious: boolean;
    isDisabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ReferralRecordSchema: Schema = new Schema({
    referrerId: { type: Schema.Types.ObjectId, required: true },
    referrerType: { type: String, enum: ['USER', 'PARTNER'], default: 'USER', required: true },
    referredId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'ReferralCampaign', required: true },
    countryCode: { type: String, required: true },
    jobsCompletedCount: { type: Number, default: 0 },
    rewardsIssuedCount: { type: Number, default: 0 },
    maxRewardableJobs: { type: Number, default: 5 },
    totalCommissionGenerated: { type: Number, default: 0 },
    lifetimeJobValue: { type: Number, default: 0 },
    lifetimePlatformRevenue: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    lifetimeEarnings: { type: Number, default: 0 },
    lastCompletedJobAt: { type: Date },
    lastCommissionDate: { type: Date },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'EXPIRED', 'SUSPENDED'], default: 'ACTIVE' },
    isFraudSuspicious: { type: Boolean, default: false },
    isDisabled: { type: Boolean, default: false }
}, { timestamps: true });

ReferralRecordSchema.index({ referrerId: 1 });
ReferralRecordSchema.index({ referredId: 1 }, { unique: true });
ReferralRecordSchema.index({ countryCode: 1 });

export default mongoose.model<IReferralRecord>('ReferralRecord', ReferralRecordSchema);
