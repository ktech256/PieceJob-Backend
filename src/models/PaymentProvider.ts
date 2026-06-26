import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentProvider extends Document {
    name: string;
    code: string; // payfast, ozow, paystack, stripe, etc.
    countryCode: string; // ISO code
    merchantId?: string;
    publicKey?: string;
    secretKey?: string;
    webhookSecret?: string;
    currency: string; // Base currency for this provider in this country
    priority: number;
    environment: 'sandbox' | 'production';
    isActive: boolean;
    updatedBy: mongoose.Types.ObjectId;
}

const PaymentProviderSchema: Schema = new Schema({
    name: { type: String, required: true },
    code: { type: String, required: true },
    countryCode: { type: String, required: true },
    merchantId: { type: String },
    publicKey: { type: String },
    secretKey: { type: String },
    webhookSecret: { type: String },
    currency: { type: String, default: 'USD' },
    priority: { type: Number, default: 0 },
    environment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

PaymentProviderSchema.index({ code: 1, countryCode: 1 }, { unique: true });
PaymentProviderSchema.index({ countryCode: 1, priority: 1 });

export default mongoose.model<IPaymentProvider>('PaymentProvider', PaymentProviderSchema);
