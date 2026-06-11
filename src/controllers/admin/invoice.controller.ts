import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Invoice from '../../models/Invoice';
import * as invoiceService from '../../services/invoice.service';

export const listInvoices = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const invoices = await Invoice.find({ countryCode }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, invoices });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Invoices failed', error });
    }
};

export const voidInvoice = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const invoice = await invoiceService.voidInvoice(id, req.user?.userId as string);
        res.status(200).json({ success: true, invoice });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const reissueInvoice = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const invoice = await invoiceService.reissueInvoice(id, req.user?.userId as string);
        res.status(200).json({ success: true, invoice });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
