import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Ledger, { TransactionType } from '../../models/Ledger';
import Wallet from '../../models/Wallet';
import Provider from '../../models/Provider';
import User from '../../models/User';
import * as reconciliationService from '../../services/reconciliation.service';
import * as statementService from '../../services/statement.service';
import * as walletService from '../../services/wallet.service';
import * as auditService from '../../services/audit.service';
import * as notificationService from '../../services/notification.service';
import { StatementType } from '../../models/Statement';
import Job, { JobStatus, IJob } from '../../models/Job';
import mongoose from 'mongoose';
import * as referralService from '../../services/referral.service';
import ReferralReward, { ReferralStatus } from '../../models/ReferralReward';
import ReferralRecord from '../../models/ReferralRecord';
import { logger } from '../../utils/logger';

import ServiceFeeRecord from '../../models/ServiceFeeRecord';
import SystemSettings from '../../models/SystemSettings';
import Country from '../../models/Country';
import * as financialService from '../../services/financial.service';

export const getServiceFeeOverview = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = { countryCode };

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [outstandingWalletsAgg, creditWalletsAgg, collectedTodayAgg, collectedThisWeekAgg, collectedThisMonthAgg, waivedAgg, bookingFeePaidAgg, collectedAllTimeAgg] = await Promise.all([
            Wallet.aggregate([
                { $match: { ...query, serviceFeeBalance: { $lt: 0 } } },
                { $group: { _id: null, total: { $sum: "$serviceFeeBalance" } } }
            ]),
            Wallet.aggregate([
                { $match: { ...query, serviceFeeBalance: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: "$serviceFeeBalance" } } }
            ]),
            Ledger.aggregate([
                { $match: { ...query, type: TransactionType.COMMISSION, createdAt: { $gte: startOfDay } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { ...query, type: TransactionType.COMMISSION, createdAt: { $gte: startOfWeek } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { ...query, type: TransactionType.COMMISSION, createdAt: { $gte: startOfMonth } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            ServiceFeeRecord.aggregate([
                { $match: { ...query, status: 'WAIVED' } },
                { $group: { _id: null, total: { $sum: "$waivedAmount" } } }
            ]),
            ServiceFeeRecord.aggregate([
                { $match: query },
                { $group: { _id: null, total: { $sum: "$bookingFeePaid" } } }
            ]),
            Ledger.aggregate([
                { $match: { ...query, type: TransactionType.COMMISSION, status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ])
        ]);

        const topOwingProviders = await Wallet.find({ ...query, role: 'PROVIDER', serviceFeeBalance: { $lt: 0 } })
            .sort({ serviceFeeBalance: 1 })
            .limit(10)
            .populate('userId', 'firstName lastName email profilePhoto');

        res.status(200).json({
            success: true,
            stats: {
                totalOutstanding: Math.abs(outstandingWalletsAgg[0]?.total || 0),
                totalCredits: creditWalletsAgg[0]?.total || 0,
                collectedToday: collectedTodayAgg[0]?.total || 0,
                collectedThisWeek: collectedThisWeekAgg[0]?.total || 0,
                collectedThisMonth: collectedThisMonthAgg[0]?.total || 0,
                collectedAllTime: collectedAllTimeAgg[0]?.total || 0,
                waivedServiceFee: waivedAgg[0]?.total || 0,
                bookingFeePaid: bookingFeePaidAgg[0]?.total || 0,
                topOwingProviders
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Service fee overview failed', error });
    }
};

export const listServiceFeeRecords = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const { status, providerId } = req.query;
        const query: any = { countryCode };
        if (status) query.status = status;
        if (providerId) query.providerId = providerId;

        const records = await ServiceFeeRecord.find(query)
            .sort({ createdAt: -1 })
            .populate('providerId', 'firstName lastName email profilePhoto')
            .populate('customerId', 'firstName lastName profilePhoto')
            .populate('jobId', 'serviceName status taskPhotos agreedPrice bookingFee');

        res.status(200).json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list service fee records', error });
    }
};

export const waiveServiceFee = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { recordId, amount, reason } = req.body;
        const record = await ServiceFeeRecord.findById(recordId).session(session);
        if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

        const waiveAmount = amount || record.outstandingBalance;
        record.waivedAmount = (record.waivedAmount || 0) + waiveAmount;
        record.outstandingBalance -= waiveAmount;
        record.status = record.outstandingBalance <= 0 ? 'WAIVED' : 'PARTIAL';
        record.waivedReason = reason;
        record.waivedBy = new mongoose.Types.ObjectId(req.user?.userId);

        record.timeline.push({
            event: 'SERVICE_FEE_WAIVED',
            timestamp: new Date(),
            metadata: { waiveAmount, reason, adminId: req.user?.userId }
        });

        await record.save({ session });

        // Update Wallet via mutateWallet to ensure Running Account (balanceCredit) is updated and audited
        await walletService.mutateWallet({
            userId: record.providerId.toString(),
            amount: waiveAmount,
            type: TransactionType.SERVICE_FEE,
            balanceType: 'balanceCredit',
            description: `Service Fee Waived (Job #${record.jobId.toString().slice(-6)})`,
            jobId: record.jobId.toString(),
            countryCode: record.countryCode,
            currency: record.currency,
            session,
            metadata: {
                action: 'WAIVE',
                adminId: req.user?.userId,
                reason
            }
        });

        await auditService.logAdminAction({
            countryCode: record.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'SERVICE_FEE_WAIVE',
            entityType: 'ServiceFeeRecord',
            entityId: record.id,
            afterState: {
                waivedAmount: record.waivedAmount,
                outstandingBalance: record.outstandingBalance,
                reason,
                jobId: record.jobId
            },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        await session.commitTransaction();
        res.status(200).json({ success: true, message: 'Service fee waived successfully' });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

export const bulkSuspendProviders = async (req: AuthRequest, res: Response) => {
    try {
        const { threshold, countryCode } = req.body;
        const providersToSuspend = await Wallet.find({
            countryCode,
            role: 'PROVIDER',
            serviceFeeBalance: { $lt: -threshold },
            isSuspended: { $ne: true }
        });

        const providerIds = providersToSuspend.map(p => p.userId);

        await Wallet.updateMany(
            { userId: { $in: providerIds } },
            {
                $set: {
                    status: 'SUSPENDED',
                    isSuspended: true,
                    suspendReason: `Bulk suspension: Outstanding service fee exceeds ${threshold}`
                }
            }
        );

        await auditService.logAdminAction({
            countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'BULK_PROVIDER_SUSPEND',
            entityType: 'Provider',
            entityId: 'BATCH',
            afterState: { threshold, count: providerIds.length, providerIds },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, count: providerIds.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Bulk suspension failed', error });
    }
};

export const bulkUnsuspendProviders = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode } = req.body;
        const providersToUnsuspend = await Wallet.find({
            countryCode,
            role: 'PROVIDER',
            isSuspended: true
        });

        const providerIds = providersToUnsuspend.map(p => p.userId);

        await Wallet.updateMany(
            { userId: { $in: providerIds } },
            {
                $set: {
                    status: 'ACTIVE',
                    isSuspended: false,
                    suspendReason: undefined
                }
            }
        );

        await auditService.logAdminAction({
            countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'BULK_PROVIDER_UNSUSPEND',
            entityType: 'Provider',
            entityId: 'BATCH',
            afterState: { count: providerIds.length, providerIds },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, count: providerIds.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Bulk unsuspension failed', error });
    }
};

export const getServiceFeeTimeline = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const record = await ServiceFeeRecord.findOne({ jobId })
            .populate('jobId')
            .populate('providerId', 'firstName lastName profilePhoto')
            .populate('customerId', 'firstName lastName profilePhoto');

        const proposals = await mongoose.model('PriceProposal').find({ jobId }).sort({ createdAt: 1 });
        const chats = await mongoose.model('ChatMessage').countDocuments({ jobId });

        if (!record) {
            const job = await Job.findById(jobId)
                .populate('customerId', 'firstName lastName profilePhoto')
                .populate('providerId', 'firstName lastName profilePhoto');
            if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

            return res.status(200).json({
                success: true,
                data: {
                    jobId: job,
                    proposals,
                    chatCount: chats,
                    isDraft: true
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                ...record.toObject(),
                proposals,
                chatCount: chats
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch timeline', error });
    }
};

export const listUsedVouchers = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const vouchers = await mongoose.model('UsedVoucher').find({ countryCode })
            .sort({ redeemedAt: -1 })
            .populate('redeemedBy', 'firstName lastName email profilePhoto');
        res.status(200).json({ success: true, data: vouchers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list vouchers', error });
    }
};

export const getOverview = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = { countryCode };

        const [country, settings] = await Promise.all([
            Country.findOne({ code: countryCode }),
            SystemSettings.findOne({ countryCode })
        ]);

        const currencySymbol = country?.currencySymbol || country?.currency;

        const [revenueAgg, serviceFeeAgg, escrowAgg, pendingPayoutsAgg, customerWalletsCount, providerWalletsAgg] = await Promise.all([
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
                netServiceFee: serviceFeeAgg[0]?.total || 0,
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
        const { status, role, search, startDate, endDate, fraud } = req.query;

        const query: any = { countryCode };

        if (status) query.status = status;

        if (fraud === 'true') {
            const suspiciousRecords = await ReferralRecord.find({ countryCode, isFraudSuspicious: true }).select('referredId');
            const suspiciousUserIds = suspiciousRecords.map(r => r.referredId);
            query.referredId = { $in: suspiciousUserIds };
        }

        let userIds: any[] = [];
        if (search) {
            const users = await User.find({
                $or: [
                    { firstName: { $regex: search, $options: 'i' } },
                    { lastName: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                    { referralCode: { $regex: search, $options: 'i' } }
                ]
            }).select('_id');
            userIds = users.map(u => u._id);
            query.$or = [{ referrerId: { $in: userIds } }, { referredId: { $in: userIds } }];
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate as string);
            if (endDate) query.createdAt.$lte = new Date(endDate as string);
        }

        const referrals = await ReferralReward.find(query)
            .sort({ createdAt: -1 })
            .populate('referrerId', 'firstName lastName email role countryCode referralCode')
            .populate('referredId', 'firstName lastName email role countryCode createdAt')
            .populate('jobId', 'serviceName status totalAmount');

        res.status(200).json({ success: true, data: referrals });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getReferralDetails = async (req: AuthRequest, res: Response) => {
    try {
        const { rewardId } = req.params;
        const reward = await ReferralReward.findById(rewardId)
            .populate('referrerId')
            .populate('referredId')
            .populate('jobId')
            .lean();

        if (!reward) return res.status(404).json({ success: false, message: 'Reward not found' });

        const referrer = reward.referrerId as any;
        const referred = reward.referredId as any;

        const [walletEntries, ledgerEntries, notifications] = await Promise.all([
            Wallet.findOne({ userId: referrer._id }),
            Ledger.find({
                $or: [
                    { transactionId: reward._id.toString() },
                    { "metadata.referredUserId": referred._id.toString() }
                ]
            }).sort({ createdAt: -1 }),
            mongoose.model('Notification').find({ userId: referrer._id, "payload.rewardId": reward._id.toString() }).sort({ createdAt: -1 })
        ]);

        const record = await ReferralRecord.findOne({ referrerId: referrer._id, referredId: referred._id });

        res.status(200).json({
            success: true,
            data: {
                reward,
                record,
                walletEntries,
                ledgerEntries,
                notifications
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getReferralAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = (req.query.countryCode as string) || req.user?.countryCode;
        if (!countryCode) return res.status(400).json({ success: false, message: 'Country code required' });

        const analytics = await referralService.getReferralAnalytics(countryCode);
        res.status(200).json({ success: true, data: analytics });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const toggleReferralPrivileges = async (req: AuthRequest, res: Response) => {
    try {
        const { userId, isDisabled } = req.body;
        const adminId = req.user?.userId || 'SYSTEM';
        const user = await referralService.toggleUserReferralPrivileges(userId, isDisabled, adminId);

        await auditService.logAdminAction({
            countryCode: user.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: isDisabled ? 'REFERRAL_PRIVILEGES_SUSPEND' : 'REFERRAL_PRIVILEGES_RESTORE',
            entityType: 'User',
            entityId: userId,
            afterState: { isReferralDisabled: isDisabled },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, data: user });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * RECALCULATE REFERRAL REWARD
 * Forensic audit of a job to see if a reward should have been triggered.
 */
export const recalculateReferralReward = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.body;
        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
        if (job.status !== JobStatus.COMPLETED && job.status !== JobStatus.CLOSED) return res.status(400).json({ success: false, message: 'Only completed jobs can be recalculated.' });

        await referralService.handleJobCompletion(job);

        await auditService.logAdminAction({
            countryCode: job.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'REFERRAL_RECALCULATE',
            entityType: 'Job',
            entityId: jobId,
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, message: 'Referral recalculation complete.' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * APPROVE PENDING REWARD
 * Force payout of a QUALIFIED or PENDING reward.
 */
export const approveReferralReward = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { rewardId, note } = req.body;
        const reward = await ReferralReward.findById(rewardId).session(session);
        if (!reward) return res.status(404).json({ success: false, message: 'Reward not found' });

        if (reward.status === ReferralStatus.REWARDED) {
            return res.status(400).json({ success: false, message: 'Reward already paid.' });
        }

        await referralService.executeRewardPayout(reward, session);

        reward.manualAudit = reward.manualAudit || [];
        reward.manualAudit.push({
            action: 'APPROVE',
            adminId: new mongoose.Types.ObjectId(req.user?.userId),
            timestamp: new Date(),
            note
        });

        await reward.save({ session });

        await auditService.logAdminAction({
            countryCode: reward.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'REFERRAL_REWARD_APPROVE',
            entityType: 'ReferralReward',
            entityId: rewardId,
            afterState: { status: 'REWARDED', note },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        }, session);

        await session.commitTransaction();

        res.status(200).json({ success: true, message: 'Referral reward approved manually.' });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * REJECT REFERRAL REWARD
 */
export const rejectReferralReward = async (req: AuthRequest, res: Response) => {
    try {
        const { rewardId, reason } = req.body;
        const reward = await ReferralReward.findById(rewardId);
        if (!reward) return res.status(404).json({ success: false, message: 'Reward not found' });

        reward.status = ReferralStatus.REJECTED;
        reward.rejectionReason = reason;
        reward.manualAudit = reward.manualAudit || [];
        reward.manualAudit.push({
            action: 'REJECT',
            adminId: new mongoose.Types.ObjectId(req.user?.userId),
            timestamp: new Date(),
            note: reason
        });

        await reward.save();

        await auditService.logAdminAction({
            countryCode: reward.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'REFERRAL_REWARD_REJECT',
            entityType: 'ReferralReward',
            entityId: rewardId,
            afterState: { status: 'REJECTED', reason },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, message: 'Referral reward rejected.' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * REVERSE REFERRAL REWARD
 * Deducts the reward from the user's wallet.
 */
export const reverseReferralReward = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { rewardId, reason } = req.body;
        const reward = await ReferralReward.findById(rewardId).session(session);
        if (!reward) return res.status(404).json({ success: false, message: 'Reward not found' });

        if (reward.status !== ReferralStatus.REWARDED) {
            return res.status(400).json({ success: false, message: 'Only rewarded items can be reversed.' });
        }

        const referrer = await User.findById(reward.referrerId).session(session);
        if (!referrer) return res.status(404).json({ success: false, message: 'Referrer not found' });

        const balanceType = reward.rewardType === 'REFERRAL_BALANCE' ? 'balanceReferral' :
                           reward.rewardType === 'WALLET_CREDIT' ? 'balanceCredit' : 'balanceMain';

        // Reverse wallet mutation
        await walletService.mutateWallet({
            userId: reward.referrerId.toString(),
            amount: -reward.amount,
            type: TransactionType.REFERRAL_REVERSAL,
            balanceType: balanceType,
            description: `Referral Reversal: ${reason} (Original Reward ID: ${reward._id})`,
            countryCode: reward.countryCode,
            currency: reward.currency,
            session,
            metadata: {
                originalRewardId: reward._id,
                adminId: req.user?.userId,
                reason
            }
        });

        reward.status = ReferralStatus.REVERSED;
        reward.manualAudit = reward.manualAudit || [];
        reward.manualAudit.push({
            action: 'REVERSE',
            adminId: new mongoose.Types.ObjectId(req.user?.userId),
            timestamp: new Date(),
            note: reason
        });

        await reward.save({ session });

        await auditService.logAdminAction({
            countryCode: reward.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'REFERRAL_REWARD_REVERSE',
            entityType: 'ReferralReward',
            entityId: rewardId,
            afterState: { status: 'REVERSED', reason },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        }, session);

        await session.commitTransaction();

        res.status(200).json({ success: true, message: 'Referral reward reversed successfully.' });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * GENERATE NEW REFERRAL CODE
 */
export const generateNewReferralCode = async (req: AuthRequest, res: Response) => {
    try {
        const { userId } = req.body;
        const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const user = await User.findByIdAndUpdate(userId, { referralCode: newCode }, { new: true });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        await auditService.logAdminAction({
            countryCode: user.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'REFERRAL_CODE_GENERATE',
            entityType: 'User',
            entityId: userId,
            afterState: { newCode },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, data: { referralCode: newCode } });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * DEACTIVATE REFERRAL CODE
 * Just sets isReferralDisabled to true.
 */
export const deactivateReferralCode = async (req: AuthRequest, res: Response) => {
    try {
        const { userId } = req.body;
        const user = await User.findByIdAndUpdate(userId, { isReferralDisabled: true }, { new: true });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        await auditService.logAdminAction({
            countryCode: user.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'REFERRAL_CODE_DEACTIVATE',
            entityType: 'User',
            entityId: userId,
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, message: 'Referral code deactivated.' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * RESEND REFERRAL NOTIFICATION
 */
export const resendReferralNotification = async (req: AuthRequest, res: Response) => {
    try {
        const { rewardId } = req.body;
        const reward = await ReferralReward.findById(rewardId).populate('referrerId referredId');
        if (!reward) return res.status(404).json({ success: false, message: 'Reward not found' });

        const referrer: any = reward.referrerId;
        const referred: any = reward.referredId;

        let title = "Referral Reward Update";
        let message = `Regarding your referral of ${referred.firstName}.`;

        if (reward.status === ReferralStatus.REWARDED) {
            title = 'Referral Reward Credited!';
            message = `Congratulations! You have earned ${reward.amount} ${reward.currency} from ${referred.firstName}'s qualifying job.`;
        } else if (reward.status === ReferralStatus.QUALIFIED) {
            title = 'Referral Qualified!';
            message = `Good news! ${referred.firstName} has completed a qualifying job. Your reward of ${reward.amount} ${reward.currency} is being processed.`;
        }

        await notificationService.notifyUser(referrer._id.toString(), title, message);

        await auditService.logAdminAction({
            countryCode: reward.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'REFERRAL_NOTIFICATION_RESEND',
            entityType: 'ReferralReward',
            entityId: rewardId,
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, message: 'Notification resent.' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * REFERRAL TEST CENTRE
 * Simulation of the referral flow.
 */
export const simulateReferralFlow = async (req: AuthRequest, res: Response) => {
    try {
        const { referrerId, referredId, stage } = req.body; // stage: 'REGISTRATION' | 'JOB_COMPLETION'

        const referrer = await User.findById(referrerId);
        const referred = await User.findById(referredId);

        if (!referrer || !referred) return res.status(404).json({ success: false, message: 'Users not found' });

        const settings = await SystemSettings.findOne({ countryCode: referrer.countryCode });

        if (stage === 'REGISTRATION') {
            const countryMismatch = referrer.countryCode !== referred.countryCode;
            const alreadyReferred = referred.referredBy && referred.referredBy.toString() !== referrer._id.toString();

            res.status(200).json({
                success: !countryMismatch && !alreadyReferred,
                message: countryMismatch ? 'FAILED: Workspace Node Mismatch' : (alreadyReferred ? 'FAILED: Target already referred by another node' : 'SUCCESS: Registration would link these nodes permanently.'),
                qualificationCheck: !countryMismatch && !alreadyReferred
            });
        } else if (stage === 'JOB_COMPLETION') {
             const isReferredByTarget = referred.referredBy?.toString() === referrer._id.toString();
             const isProgramEnabled = settings?.referralProgramEnabled ?? true;
             const isUserDisabled = referrer.isReferralDisabled;

             let message = 'Simulation verified.';
             let success = true;

             if (!isReferredByTarget) {
                 message = 'FAILED: Target node is not referred by simulation source.';
                 success = false;
             } else if (!isProgramEnabled) {
                 message = 'FAILED: Referral program is disabled in this workspace node.';
                 success = false;
             } else if (isUserDisabled) {
                 message = 'FAILED: Referrer privileges are suspended.';
                 success = false;
             } else {
                 message = `SUCCESS: Logic verified. Reward of ${settings?.referralRewardAmount || 10} ${referrer.countryCode} would be triggered. Payout delay: ${settings?.referralRewardDelayDays || 0} days.`;
             }

             res.status(200).json({
                 success,
                 message,
                 qualificationCheck: success
             });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getLedger = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const { type, providerId } = req.query;
        const query: any = { countryCode };
        if (type) query.type = type;
        if (providerId) query.toUserId = providerId;

        const logs = await Ledger.find(query).sort({ createdAt: -1 }).limit(200)
            .populate('toUserId', 'firstName lastName')
            .populate('fromUserId', 'firstName lastName')
            .populate('jobId', 'serviceName');

        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Ledger failed', error });
    }
};

export const getAuditTrail = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const { action, targetId } = req.query;
        const query: any = { countryCode };
        if (action) query.action = action;
        if (targetId) query.entityId = targetId;

        const logs = await mongoose.model('AuditLog').find(query).sort({ createdAt: -1 }).limit(200)
            .populate('adminId', 'firstName lastName');

        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Audit trail failed', error });
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

/**
 * Manually credit a provider's wallet balance (specifically balanceCredit).
 * This is used for adjustments, bonuses, goodwill, etc.
 */
export const issueManualCredit = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { providerId, amount, reason, notes } = req.body;
        const adminId = req.user?.userId;

        if (!providerId || !amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid providerId or amount' });
        }

        const providerUser = await User.findById(providerId).session(session);
        if (!providerUser) {
            return res.status(404).json({ success: false, message: 'Provider user not found' });
        }

        const country = await Country.findOne({ code: providerUser.countryCode }).session(session);
        const currency = country?.currency || 'USD';

        // 1. Mutate Wallet balanceCredit
        const result = await walletService.mutateWallet({
            userId: providerId,
            amount,
            type: TransactionType.MANUAL_CREDIT,
            balanceType: 'balanceCredit',
            description: reason || 'Manual Admin Credit',
            countryCode: providerUser.countryCode,
            currency,
            session,
            metadata: {
                manual: true,
                adminId,
                notes,
                reason,
                workspace: providerUser.countryCode
            }
        });

        // 3. Reconcile with Service Fee Records
        // This ensures the Manual Credit immediately reduces outstanding job debts.
        await financialService.reconcileProviderCredit(providerId, amount, session, {
            source: 'MANUAL_CREDIT',
            description: reason,
            adminId,
            currency,
            countryCode: providerUser.countryCode
        });

        // 2. Log Admin Action for Audit
        await auditService.logAdminAction({
            countryCode: providerUser.countryCode,
            adminId: adminId as string,
            adminRole: req.user?.role as string,
            action: 'MANUAL_CREDIT_ISSUED',
            entityType: 'Wallet',
            entityId: result?.wallet?._id?.toString() || 'unknown',
            afterState: {
                providerId,
                amount,
                reason,
                notes,
                newBalance: result?.wallet?.balanceCredit
            },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        }, session);

        await session.commitTransaction();

        res.status(200).json({
            success: true,
            message: 'Manual credit issued successfully',
            data: {
                transactionId: result?.ledger?.transactionId,
                newBalance: result?.wallet?.balanceCredit
            }
        });
    } catch (error: any) {
        await session.abortTransaction();
        logger.error(`FINANCE | MANUAL_CREDIT_FAILED | Provider: ${req.body.providerId} | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * Manually debit a provider's wallet balance (specifically balanceCredit).
 * This is used for penalties, overpayment recovery, etc.
 */
export const issueManualDebit = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { providerId, amount, reason, notes } = req.body;
        const adminId = req.user?.userId;

        if (!providerId || !amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid providerId or amount' });
        }

        const providerUser = await User.findById(providerId).session(session);
        if (!providerUser) {
            return res.status(404).json({ success: false, message: 'Provider user not found' });
        }

        const country = await Country.findOne({ code: providerUser.countryCode }).session(session);
        const currency = country?.currency || 'USD';

        // 1. Mutate Wallet balanceCredit (Negative amount for debit)
        const result = await walletService.mutateWallet({
            userId: providerId,
            amount: -amount,
            type: TransactionType.MANUAL_DEBIT,
            balanceType: 'balanceCredit',
            description: reason || 'Manual Admin Debit/Penalty',
            countryCode: providerUser.countryCode,
            currency,
            session,
            metadata: {
                manual: true,
                adminId,
                notes,
                reason,
                workspace: providerUser.countryCode
            }
        });

        // 2. Log Admin Action for Audit
        await auditService.logAdminAction({
            countryCode: providerUser.countryCode,
            adminId: adminId as string,
            adminRole: req.user?.role as string,
            action: 'MANUAL_DEBIT_ISSUED',
            entityType: 'Wallet',
            entityId: result?.wallet?._id?.toString() || 'unknown',
            afterState: {
                providerId,
                amount,
                reason,
                notes,
                newBalance: result?.wallet?.balanceCredit
            },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        }, session);

        await session.commitTransaction();

        res.status(200).json({
            success: true,
            message: 'Manual debit issued successfully',
            data: {
                transactionId: result?.ledger?.transactionId,
                newBalance: result?.wallet?.balanceCredit
            }
        });
    } catch (error: any) {
        await session.abortTransaction();
        logger.error(`FINANCE | MANUAL_DEBIT_FAILED | Provider: ${req.body.providerId} | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};
