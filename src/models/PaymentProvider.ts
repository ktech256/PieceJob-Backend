import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentProvider extends Document {
    name: string;
    code: string; // payfast, ozow, stripe, etc.
    merchantId?: string;
    publicKey?: string;
    secretKey?: string;
    webhookSecret?: string;
    currency: string[];
    countries: string[];
    priority: number;
    environment: 'sandbox' | 'production';
    isActive: boolean;
    updatedBy: mongoose.Types.ObjectId;
}

const PaymentProviderSchema: Schema = new Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    merchantId: { type: String },
    publicKey: { type: String },
    secretKey: { type: String },
    webhookSecret: { type: String },
    currency: [{ type: String }],
    countries: [{ type: String }], // ISO codes
    priority: { type: Number, default: 0 },
    environment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model<IPaymentProvider>('PaymentProvider', PaymentProviderSchema);
