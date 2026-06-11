import mongoose, { Schema, Document } from 'mongoose';

export enum InvoiceStatus {
  ACTIVE = 'ACTIVE',
  VOIDED = 'VOIDED',
  REISSUED = 'REISSUED',
  CREDIT_NOTE = 'CREDIT_NOTE',
  DEBIT_NOTE = 'DEBIT_NOTE'
}

export interface IInvoice extends Document {
  invoiceNumber: string; // Format: INV-YYYY-000001
  jobId?: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  providerId?: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  countryCode: string;
  status: InvoiceStatus;
  originalInvoiceId?: mongoose.Types.ObjectId; // For reissues/notes
  reissuedAsId?: mongoose.Types.ObjectId;
  pdfUrl?: string;
  metadata: any;
  createdAt: Date;
}

const InvoiceSchema: Schema = new Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'Provider' },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  countryCode: { type: String, required: true },
  status: { type: String, enum: Object.values(InvoiceStatus), default: InvoiceStatus.ACTIVE },
  originalInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  reissuedAsId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  pdfUrl: { type: String },
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

InvoiceSchema.index({ invoiceNumber: 1 });
InvoiceSchema.index({ customerId: 1, createdAt: -1 });
InvoiceSchema.index({ countryCode: 1 });

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);
