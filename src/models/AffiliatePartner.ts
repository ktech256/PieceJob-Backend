import mongoose, { Schema, Document } from 'mongoose';

export enum AffiliateStatus {
    ACTIVE = 'ACTIVE',
    SUSPENDED = 'SUSPENDED',
    DORMANT = 'DORMANT'
}

export interface IAffiliatePartner extends Document {
    name: string;
    company?: string;
    type: string; // Influencer, Media, Agency, etc.
    contactPerson: string;
    phone: string;
    email: string;
    website?: string;
    countryCode: string;
    referralCode: string;
    commissionModel: 'PERCENTAGE' | 'FIXED';
    commissionValue: number; // % or Fixed Amount
    status: AffiliateStatus;
    passwordHash: string;
    resetPasswordToken?: string;
    resetPasswordExpires?: Date;
    campaign?: string;
    notes?: string;
    stats: {
        clicks: number;
        registrations: number;
        verifiedRegistrations: number;
        qualifiedUsers: number;
        customerSignups: number;
        providerSignups: number;
        businessSignups: number;
        completedJobs: number;
        rewardedJobs: number;
    };
    balance: {
        pending: number;
        available: number;
        requested: number;
        processing: number;
        paid: number;
        lifetime: number;
    };
    bankingDetails?: {
        bankName: string;
        accountHolder: string;
        accountNumber: string;
        branchCode: string;
        accountType: string;
        swiftCode?: string;
    };
    commissionSettings: {
        customerReward: number;
        providerReward: number;
        businessReward: number;
        maxRewardableJobs: number;
        customerEnabled: boolean;
        providerEnabled: boolean;
        businessEnabled: boolean;
        effectiveDate: Date;
        createdBy?: string;
        updatedBy?: string;
    };
    createdAt: Date;
    updatedAt: Date;
}

const AffiliatePartnerSchema: Schema = new Schema({
    name: { type: String, required: true },
    company: { type: String },
    type: { type: String, required: true },
    contactPerson: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    website: { type: String },
    countryCode: { type: String, required: true },
    referralCode: { type: String, required: true, unique: true },
    commissionModel: { type: String, enum: ['PERCENTAGE', 'FIXED'], default: 'FIXED' },
    commissionValue: { type: Number, required: true },
    status: { type: String, enum: Object.values(AffiliateStatus), default: AffiliateStatus.ACTIVE },
    passwordHash: { type: String, required: true },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    campaign: { type: String },
    notes: { type: String },
    stats: {
        clicks: { type: Number, default: 0 },
        registrations: { type: Number, default: 0 },
        verifiedRegistrations: { type: Number, default: 0 },
        qualifiedUsers: { type: Number, default: 0 },
        customerSignups: { type: Number, default: 0 },
        providerSignups: { type: Number, default: 0 },
        businessSignups: { type: Number, default: 0 },
        completedJobs: { type: Number, default: 0 },
        rewardedJobs: { type: Number, default: 0 }
    },
    balance: {
        pending: { type: Number, default: 0 },
        available: { type: Number, default: 0 },
        requested: { type: Number, default: 0 },
        processing: { type: Number, default: 0 },
        paid: { type: Number, default: 0 },
        lifetime: { type: Number, default: 0 }
    },
    bankingDetails: {
        bankName: { type: String },
        accountHolder: { type: String },
        accountNumber: { type: String },
        branchCode: { type: String },
        accountType: { type: String },
        swiftCode: { type: String }
    },
    commissionSettings: {
        customerReward: { type: Number, default: 10 },
        providerReward: { type: Number, default: 20 },
        businessReward: { type: Number, default: 50 },
        maxRewardableJobs: { type: Number, default: 5 },
        customerEnabled: { type: Boolean, default: true },
        providerEnabled: { type: Boolean, default: true },
        businessEnabled: { type: Boolean, default: true },
        effectiveDate: { type: Date, default: Date.now },
        createdBy: { type: String },
        updatedBy: { type: String }
    }
}, { timestamps: true });

AffiliatePartnerSchema.index({ referralCode: 1 });
AffiliatePartnerSchema.index({ email: 1 }, { unique: true });
AffiliatePartnerSchema.index({ countryCode: 1 });

export default mongoose.model<IAffiliatePartner>('AffiliatePartner', AffiliatePartnerSchema);
