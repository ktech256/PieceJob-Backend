import mongoose, { Schema, Document } from 'mongoose';

export enum ReferralStatus {
    PENDING = 'PENDING',
    QUALIFIED = 'QUALIFIED',
    REWARDED = 'REWARDED',
    EXPIRED = 'EXPIRED',
    REJECTED = 'REJECTED',
    DISABLED = 'DISABLED'
}

export interface IReferralReward extends Document {
    referrerId: mongoose.Types.ObjectId;
    referredId: mongoose.Types.ObjectId;
    jobId: mongoose.Types.ObjectId;
    campaignId: mongoose.Types.ObjectId;
    amount: number;
    currency: string;
    status: ReferralStatus;
    countryCode: string;
    scheduledAt: Date;
    processedAt?: Date;
    rejectionReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ReferralRewardSchema: Schema = new Schema({
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referredId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'ReferralCampaign', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, enum: Object.values(ReferralStatus), default: ReferralStatus.PENDING },
    countryCode: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    processedAt: { type: Date },
    rejectionReason: { type: String }
}, { timestamps: true });

ReferralRewardSchema.index({ referrerId: 1 });
ReferralRewardSchema.index({ referredId: 1 });
ReferralRewardSchema.index({ referredId: 1, jobId: 1 }, { unique: true });
ReferralRewardSchema.index({ status: 1 });
ReferralRewardSchema.index({ countryCode: 1 });

export default mongoose.model<IReferralReward>('ReferralReward', ReferralRewardSchema);
