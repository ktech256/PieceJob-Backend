import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Ledger, { TransactionType } from '../../models/Ledger';
import Wallet from '../../models/Wallet';
import Provider from '../../models/Provider';
import * as reconciliationService from '../../services/reconciliation.service';
import * as statementService from '../../services/statement.service';
import { StatementType } from '../../models/Statement';
import mongoose from 'mongoose';

import Country from '../../models/Country';
import SystemSettings from '../../models/SystemSettings';
import * as financialService from '../../services/financial.service';

export const getOverview = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = { countryCode };

        const [country, settings] = await Promise.all([
            Country.findOne({ code: countryCode }),
            SystemSettings.findOne({ countryCode })
        ]);

        const currencySymbol = country?.currencySymbol || country?.currency;

        const [revenueAgg, commissionAgg, escrowAgg, pendingPayoutsAgg, customerWalletsCount, providerWalletsAgg] = await Promise.all([
            Ledger.aggregate([
                { $match: { ...query, status: 'COMPLETED', type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { ...query, status: 'COMPLETED', type: TransactionType.COMMISSION } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Wallet.aggregate([
                { $match: { countryCode } },
                { $group: { _id: null, total: { $sum: "$balanceEscrow" } } }
            ]),
            Ledger.aggregate([
                { $match: { ...query, status: 'PENDING', type: TransactionType.PAYOUT } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            mongoose.model('User').countDocuments({ countryCode, role: 'CUSTOMER' }),
            Provider.aggregate([
                { $match: { countryCode } },
                { $group: { _id: null, count: { $sum: 1 } } }
            ])
        ]);

        const pendingRefundsAgg = await Ledger.aggregate([
            { $match: { ...query, status: 'PENDING', type: TransactionType.REFUND } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const bonusAgg = await Wallet.aggregate([
            { $match: { countryCode } },
            { $group: { _id: null, total: { $sum: "$balanceBonus" } } }
        ]);

        res.status(200).json({
            success: true,
            stats: {
                totalRevenue: revenueAgg[0]?.total || 0,
                netCommission: commissionAgg[0]?.total || 0,
                pendingPayouts: pendingPayoutsAgg[0]?.total || 0,
                activeEscrow: escrowAgg[0]?.total || 0,
                totalCustomerWallets: customerWalletsCount,
                totalProviderWallets: providerWalletsAgg[0]?.count || 0,
                pendingRefunds: pendingRefundsAgg[0]?.total || 0,
                totalBonuses: bonusAgg[0]?.total || 0,
                currency: country?.currency,
                currencySymbol: currencySymbol,
                mismatchErrors: 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Overview failed', error });
    }
};

export const listWallets = async (req: AuthRequest, res: Response) => {
    try {
        const { role } = req.query;
        const countryCode = req.query.countryCode as string || req.user?.countryCode;

        const userQuery: any = { countryCode };
        if (role) userQuery.role = role;

        const users = await mongoose.model('User').find(userQuery).select('firstName lastName email role');
        const userIds = users.map((u: any) => u._id);

        const wallets = await Wallet.find({ userId: { $in: userIds } });

        const data = users.map((u: any) => {
            const w = wallets.find(wal => wal.userId.toString() === u._id.toString());
            return {
                user: u,
                wallet: w || { balanceMain: 0, balanceEscrow: 0, balanceCredit: 0, balanceReferral: 0, balanceBonus: 0, status: 'ACTIVE' }
            };
        });

        res.status(200).json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const listRefunds = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const refunds = await Ledger.find({ countryCode, type: TransactionType.REFUND })
            .sort({ createdAt: -1 })
            .populate('fromUserId', 'firstName lastName')
            .populate('toUserId', 'firstName lastName')
            .populate('jobId', 'id');
        res.status(200).json({ success: true, data: refunds });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const listReferrals = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const referrals = await Ledger.find({ countryCode, type: TransactionType.REFERRAL_REWARD })
            .sort({ createdAt: -1 })
            .populate('toUserId', 'firstName lastName');
        res.status(200).json({ success: true, data: referrals });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
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
