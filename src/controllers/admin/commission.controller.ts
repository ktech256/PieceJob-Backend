import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import CommissionRecord from '../../models/CommissionRecord';
import Wallet from '../../models/Wallet';
import Ledger from '../../models/Ledger';
import Job from '../../models/Job';
import SystemSettings from '../../models/SystemSettings';
import AuditLog from '../../models/AuditLog';
import User from '../../models/User';
import mongoose from 'mongoose';

export const getCommissionOverview = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || 'ZA';

        const now = new Date();
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [walletAgg, todayAgg, weekAgg, monthAgg, recordAgg] = await Promise.all([
            Wallet.aggregate([
                { $match: { countryCode } },
                { $group: { _id: null, total: { $sum: "$outstandingCommission" } } }
            ]),
            Ledger.aggregate([
                { $match: { countryCode, type: 'CREDIT_TOPUP', status: 'COMPLETED', createdAt: { $gte: startOfToday } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { countryCode, type: 'CREDIT_TOPUP', status: 'COMPLETED', createdAt: { $gte: startOfWeek } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { countryCode, type: 'CREDIT_TOPUP', status: 'COMPLETED', createdAt: { $gte: startOfMonth } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            CommissionRecord.aggregate([
                { $match: { countryCode } },
                { $group: {
                    _id: null,
                    credits: { $sum: "$bookingFeeCredit" },
                    waived: { $sum: "$waivedAmount" }
                } }
            ])
        ]);

        const topOwingProviders = await Wallet.find({ countryCode, outstandingCommission: { $gt: 0 } })
            .sort({ outstandingCommission: -1 })
            .limit(5)
            .populate('userId', 'firstName lastName email profilePhoto');

        res.status(200).json({
            success: true,
            stats: {
                outstandingCommission: walletAgg[0]?.total || 0,
                collectedToday: todayAgg[0]?.total || 0,
                collectedThisWeek: weekAgg[0]?.total || 0,
                collectedThisMonth: monthAgg[0]?.total || 0,
                bookingFeeCredits: recordAgg[0]?.credits || 0,
                waivedCommission: recordAgg[0]?.waived || 0,
                topOwingProviders
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch overview', error });
    }
};

export const listCommissionRecords = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || 'ZA';
        const records = await CommissionRecord.find({ countryCode })
            .sort({ createdAt: -1 })
            .populate('jobId', 'serviceName')
            .populate('providerId', 'firstName lastName email profilePhoto');

        res.status(200).json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch records' });
    }
};

export const listUsedVouchers = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || 'ZA';
        const vouchers = await Ledger.find({
            countryCode,
            type: 'CREDIT_TOPUP',
            'metadata.vendor': { $exists: true }
        }).sort({ createdAt: -1 })
          .populate('fromUserId', 'firstName lastName email');

        // Note: Ledger uses fromUserId for some outgoing and toUserId for some incoming.
        // We'll normalize for the response.
        const data = vouchers.map(v => ({
            _id: v._id,
            voucherNumber: v.metadata?.voucherNumber,
            vendor: v.metadata?.vendor,
            amount: v.amount,
            redeemedBy: v.toUserId || v.fromUserId, // Depending on how it was logged
            redeemedAt: v.createdAt
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch vouchers' });
    }
};

export const getCommissionTimeline = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const record = await CommissionRecord.findOne({ jobId })
            .populate('jobId')
            .populate('providerId', 'firstName lastName profilePhoto')
            .populate('customerId', 'firstName lastName profilePhoto');

        if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

        // Build a timeline of events from AuditLogs and Ledger
        const auditLogs = await AuditLog.find({ entityId: jobId }).sort({ createdAt: 1 });
        const ledgerEntries = await Ledger.find({ jobId }).sort({ createdAt: 1 });

        const timeline = [
            ...auditLogs.map(l => ({ event: l.action, timestamp: l.createdAt, metadata: l.afterState })),
            ...ledgerEntries.map(e => ({ event: `LEDGER_${e.type}`, timestamp: e.createdAt, metadata: { amount: e.amount, status: e.status } }))
        ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        res.status(200).json({ success: true, data: { ...record.toObject(), timeline } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch timeline' });
    }
};

export const bulkSuspend = async (req: AuthRequest, res: Response) => {
    try {
        const { threshold, countryCode } = req.body;
        const result = await Wallet.updateMany(
            { countryCode, outstandingCommission: { $gt: threshold }, isSuspended: false },
            {
                $set: {
                    status: 'SUSPENDED',
                    isSuspended: true,
                    suspendReason: `Bulk suspension: Owed > ${threshold}`
                }
            }
        );
        res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Bulk action failed' });
    }
};

export const bulkUnsuspend = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode } = req.body;
        const result = await Wallet.updateMany(
            { countryCode, isSuspended: true },
            {
                $set: {
                    status: 'ACTIVE',
                    isSuspended: false,
                    suspendReason: null
                }
            }
        );
        res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Bulk action failed' });
    }
};

export const waiveCommission = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { recordId, reason } = req.body;
        const adminId = req.user?.userId;

        const record = await CommissionRecord.findById(recordId).session(session);
        if (!record) throw new Error('Record not found');

        const amountToWaive = record.outstandingBalance;
        if (amountToWaive <= 0) throw new Error('No outstanding balance to waive');

        record.waivedAmount = amountToWaive;
        record.waivedReason = reason;
        record.waivedBy = new mongoose.Types.ObjectId(adminId);
        record.outstandingBalance = 0;
        record.status = 'WAIVED';
        await record.save({ session });

        // Update Wallet
        const wallet = await Wallet.findOne({ userId: record.providerId }).session(session);
        if (wallet) {
            wallet.outstandingCommission = Math.max(0, wallet.outstandingCommission - amountToWaive);
            // Check if can unsuspend
            const settings = await SystemSettings.findOne({ countryCode: record.countryCode }) || await SystemSettings.findOne({ countryCode: 'GLOBAL' });
            if (wallet.outstandingCommission <= (settings?.commissionSuspensionThreshold || 100)) {
                wallet.status = 'ACTIVE';
                wallet.isSuspended = false;
            }
            await wallet.save({ session });
        }

        await session.commitTransaction();
        res.status(200).json({ success: true });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};
