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
    termsUrl: { type: String }
}, { timestamps: true });

ReferralCampaignSchema.index({ countryCode: 1, isActive: 1, startDate: 1, endDate: 1 });

export default mongoose.model<IReferralCampaign>('ReferralCampaign', ReferralCampaignSchema);
