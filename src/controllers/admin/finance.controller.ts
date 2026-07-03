import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Ledger, { TransactionType } from '../../models/Ledger';
import Wallet from '../../models/Wallet';
import * as reconciliationService from '../../services/reconciliation.service';
import * as statementService from '../../services/statement.service';
import { StatementType } from '../../models/Statement';

import Country from '../../models/Country';
import SystemSettings from '../../models/SystemSettings';

export const getOverview = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = { countryCode };

        const [country, settings] = await Promise.all([
            Country.findOne({ code: countryCode }),
            SystemSettings.findOne({ countryCode })
        ]);

        const currencySymbol = country?.currencySymbol || country?.currency;

        const revenueAgg = await Ledger.aggregate([
            { $match: { ...query, status: 'COMPLETED', type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const commissionAgg = await Ledger.aggregate([
            { $match: { ...query, status: 'COMPLETED', type: TransactionType.COMMISSION } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const escrowAgg = await Wallet.aggregate([
            { $match: { countryCode } },
            { $group: { _id: null, total: { $sum: "$balanceEscrow" } } }
        ]);

        const pendingPayoutsAgg = await Ledger.aggregate([
            { $match: { ...query, status: 'PENDING', type: TransactionType.PAYOUT } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        res.status(200).json({
            success: true,
            stats: {
                totalRevenue: revenueAgg[0]?.total || 0,
                netCommission: commissionAgg[0]?.total || 0,
                pendingPayouts: pendingPayoutsAgg[0]?.total || 0,
                activeEscrow: escrowAgg[0]?.total || 0,
                currency: country?.currency,
                currencySymbol: currencySymbol,
                mismatchErrors: 0 // Will be wired to reconciliation result
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Overview failed', error });
    }
};

export const getLedger = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const logs = await Ledger.find({ countryCode }).sort({ createdAt: -1 }).limit(100);
        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Ledger failed', error });
    }
};

export const runReconciliation = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const results = await reconciliationService.runFullReconciliation(countryCode as string);
        res.status(200).json({ success: true, results });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

import * as financialService from '../../services/financial.service';

export const processRefund = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const { reason } = req.body;
        await financialService.refundJob(jobId, reason);
        res.status(200).json({ success: true, message: 'Refund processed successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const generateProviderStatement = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId, type, start, end } = req.body;
        const countryCode = req.user?.countryCode as string;
        const statement = await statementService.generateStatement(
            providerId,
            'PROVIDER',
            type as StatementType,
            new Date(start),
            new Date(end),
            countryCode
        );
        res.status(200).json({ success: true, statement });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
