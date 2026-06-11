import Invoice, { InvoiceStatus } from '../models/Invoice';
import Counter from '../models/Counter';
import mongoose from 'mongoose';

const getNextSequence = async (countryCode: string) => {
    const counter = await Counter.findOneAndUpdate(
        { id: `invoice_${countryCode}` },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
    );
    return counter.seq;
};

export const createInvoice = async (jobId: string, customerId: string, providerId: string, amount: number, currency: string, countryCode: string) => {
    const seq = await getNextSequence(countryCode);
    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${seq.toString().padStart(6, '0')}`;

    const invoice = new Invoice({
        invoiceNumber,
        jobId,
        customerId,
        providerId,
        amount,
        currency,
        countryCode,
        status: InvoiceStatus.ACTIVE
    });

    await invoice.save();
    return invoice;
};

export const voidInvoice = async (invoiceId: string, adminId: string) => {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    invoice.status = InvoiceStatus.VOIDED;
    invoice.metadata = { ...invoice.metadata, voidedBy: adminId, voidedAt: new Date() };
    await invoice.save();
    return invoice;
};

export const reissueInvoice = async (invoiceId: string, adminId: string) => {
    const original = await Invoice.findById(invoiceId);
    if (!original) throw new Error('Original invoice not found');

    if (original.status !== InvoiceStatus.VOIDED) {
        throw new Error('Must void original invoice before reissuing');
    }

    const seq = original.invoiceNumber.split('-')[2];
    const year = original.invoiceNumber.split('-')[1];
    const newInvoiceNumber = `INV-${year}-${seq}-R1`;

    const reissued = new Invoice({
        ...original.toObject(),
        _id: new mongoose.Types.ObjectId(),
        invoiceNumber: newInvoiceNumber,
        status: InvoiceStatus.ACTIVE,
        originalInvoiceId: original._id,
        metadata: { ...original.metadata, reissuedBy: adminId, reissuedAt: new Date() }
    });

    await reissued.save();

    original.reissuedAsId = reissued._id as any;
    await original.save();

    return reissued;
};

export const createCreditNote = async (originalInvoiceId: string, amount: number, adminId: string) => {
    const original = await Invoice.findById(originalInvoiceId);
    if (!original) throw new Error('Original invoice not found');

    const seq = await getNextSequence(original.countryCode);
    const year = new Date().getFullYear();
    const creditNoteNumber = `CRN-${year}-${seq.toString().padStart(6, '0')}`;

    const creditNote = new Invoice({
        ...original.toObject(),
        _id: new mongoose.Types.ObjectId(),
        invoiceNumber: creditNoteNumber,
        amount,
        status: InvoiceStatus.CREDIT_NOTE,
        originalInvoiceId: original._id,
        metadata: { ...original.metadata, createdBy: adminId, createdAt: new Date(), type: 'CREDIT_NOTE' }
    });

    await creditNote.save();
    return creditNote;
};

export const createDebitNote = async (originalInvoiceId: string, amount: number, adminId: string) => {
    const original = await Invoice.findById(originalInvoiceId);
    if (!original) throw new Error('Original invoice not found');

    const seq = await getNextSequence(original.countryCode);
    const year = new Date().getFullYear();
    const debitNoteNumber = `DBN-${year}-${seq.toString().padStart(6, '0')}`;

    const debitNote = new Invoice({
        ...original.toObject(),
        _id: new mongoose.Types.ObjectId(),
        invoiceNumber: debitNoteNumber,
        amount,
        status: InvoiceStatus.DEBIT_NOTE,
        originalInvoiceId: original._id,
        metadata: { ...original.metadata, createdBy: adminId, createdAt: new Date(), type: 'DEBIT_NOTE' }
    });

    await debitNote.save();
    return debitNote;
};
