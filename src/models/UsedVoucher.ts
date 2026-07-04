import mongoose, { Schema, Document } from 'mongoose';

export interface IUsedVoucher extends Document {
    voucherNumber: string;
    vendor: string;
    amount: number;
    countryCode: string;
    redeemedBy: mongoose.Types.ObjectId;
    redeemedAt: Date;
    ledgerReference?: string;
}

const UsedVoucherSchema: Schema = new Schema({
    voucherNumber: { type: String, required: true },
    vendor: { type: String, required: true },
    amount: { type: Number, required: true },
    countryCode: { type: String, required: true },
    redeemedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    redeemedAt: { type: Date, default: Date.now },
    ledgerReference: { type: String }
}, { timestamps: true });

UsedVoucherSchema.index({ voucherNumber: 1, vendor: 1 }, { unique: true });
UsedVoucherSchema.index({ redeemedBy: 1 });

export default mongoose.model<IUsedVoucher>('UsedVoucher', UsedVoucherSchema);
