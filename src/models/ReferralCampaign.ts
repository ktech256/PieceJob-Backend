import mongoose, { Schema, Document } from 'mongoose';

export interface IReferralCampaign extends Document {
    title: string;
    description: string;
    rewardAmount: number;
    currency: string;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    countryCode: string;
    bannerUrl?: string;
    termsUrl?: string;

    // Admin Controls
    maxRewardsPerReferral: number; // Max jobs to reward from same referral (Default 5)
    minCompletedJobs: number;      // Jobs needed before qualifying (Default 1)
    rewardDelayDays: number;       // Delay in days before payout (Default 0)
    rewardExpiryDays?: number;     // Days until unused reward expires (Optional)

    createdAt: Date;
    updatedAt: Date;
}

const ReferralCampaignSchema: Schema = new Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    rewardAmount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    countryCode: { type: String, required: true },
    bannerUrl: { type: String },
    termsUrl: { type: String },

    maxRewardsPerReferral: { type: Number, default: 5 },
    minCompletedJobs: { type: Number, default: 1 },
    rewardDelayDays: { type: Number, default: 0 },
    rewardExpiryDays: { type: Number }
}, { timestamps: true });

ReferralCampaignSchema.index({ countryCode: 1, isActive: 1, startDate: 1, endDate: 1 });

export default mongoose.model<IReferralCampaign>('ReferralCampaign', ReferralCampaignSchema);
