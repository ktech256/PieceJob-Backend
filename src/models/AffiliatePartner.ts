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
    campaign?: string;
    notes?: string;
    stats: {
        clicks: number;
        registrations: number;
        qualifiedUsers: number;
        completedJobs: number;
    };
    balance: {
        pending: number;
        available: number;
        paid: number;
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
    email: { type: String, required: true, unique: true },
    website: { type: String },
    countryCode: { type: String, required: true },
    referralCode: { type: String, required: true, unique: true },
    commissionModel: { type: String, enum: ['PERCENTAGE', 'FIXED'], default: 'FIXED' },
    commissionValue: { type: Number, required: true },
    status: { type: String, enum: Object.values(AffiliateStatus), default: AffiliateStatus.ACTIVE },
    passwordHash: { type: String, required: true },
    campaign: { type: String },
    notes: { type: String },
    stats: {
        clicks: { type: Number, default: 0 },
        registrations: { type: Number, default: 0 },
        qualifiedUsers: { type: Number, default: 0 },
        completedJobs: { type: Number, default: 0 }
    },
    balance: {
        pending: { type: Number, default: 0 },
        available: { type: Number, default: 0 },
        paid: { type: Number, default: 0 }
    }
}, { timestamps: true });

AffiliatePartnerSchema.index({ referralCode: 1 });
AffiliatePartnerSchema.index({ email: 1 }, { unique: true });
AffiliatePartnerSchema.index({ countryCode: 1 });

export default mongoose.model<IAffiliatePartner>('AffiliatePartner', AffiliatePartnerSchema);
