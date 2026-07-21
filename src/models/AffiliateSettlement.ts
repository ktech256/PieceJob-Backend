import mongoose, { Schema, Document } from 'mongoose';

export enum SettlementStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    PROCESSING = 'PROCESSING',
    PAID = 'PAID',
    REJECTED = 'REJECTED',
    CANCELLED = 'CANCELLED',
    RETURNED = 'RETURNED'
}

export interface IAffiliateSettlement extends Document {
    settlementId: string;
    partnerId: mongoose.Types.ObjectId;
    amount: number;
    currency: string;
    countryCode: string;
    status: SettlementStatus;
    requestedAt: Date;
    processedAt?: Date;
    paidAt?: Date;
    paymentReference?: string;
    bankDetails: {
        bankName: string;
        accountHolder: string;
        accountNumber: string;
        branchCode: string;
        accountType: string;
    };
    adminNotes?: string;
    partnerNotes?: string;
    auditLog: {
        action: string;
        adminId?: string;
        timestamp: Date;
        oldStatus?: string;
        newStatus: string;
        note?: string;
    }[];
    riskScore: number;
    createdAt: Date;
    updatedAt: Date;
}

const AffiliateSettlementSchema: Schema = new Schema({
    settlementId: { type: String, required: true, unique: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'AffiliatePartner', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    countryCode: { type: String, required: true },
    status: { type: String, enum: Object.values(SettlementStatus), default: SettlementStatus.PENDING },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    paidAt: { type: Date },
    paymentReference: { type: String },
    bankDetails: {
        bankName: { type: String, required: true },
        accountHolder: { type: String, required: true },
        accountNumber: { type: String, required: true },
        branchCode: { type: String, required: true },
        accountType: { type: String, required: true }
    },
    adminNotes: { type: String },
    partnerNotes: { type: String },
    auditLog: [{
        action: { type: String, required: true },
        adminId: { type: String },
        timestamp: { type: Date, default: Date.now },
        oldStatus: { type: String },
        newStatus: { type: String, required: true },
        note: { type: String }
    }],
    riskScore: { type: Number, default: 0 }
}, { timestamps: true });

AffiliateSettlementSchema.index({ settlementId: 1 });
AffiliateSettlementSchema.index({ partnerId: 1 });
AffiliateSettlementSchema.index({ status: 1 });

export default mongoose.model<IAffiliateSettlement>('AffiliateSettlement', AffiliateSettlementSchema);
