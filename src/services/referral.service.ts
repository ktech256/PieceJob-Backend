import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import ReferralCampaign from '../models/ReferralCampaign';
import ReferralRecord from '../models/ReferralRecord';
import ReferralReward, { ReferralStatus } from '../models/ReferralReward';
import AffiliatePartner, { AffiliateStatus } from '../models/AffiliatePartner';
import Country from '../models/Country';
import SystemSettings from '../models/SystemSettings';
import Ledger, { TransactionType } from '../models/Ledger';
import * as walletService from './wallet.service';
import * as financialService from './financial.service';
import * as notificationService from './notification.service';
import * as notificationQueue from './notification.queue';
import { logger } from '../utils/logger';
import { IJob } from '../models/Job';
import { v4 as uuidv4 } from 'uuid';

/**
 * Triggered when a job is completed.
 * Checks if the customer or provider was referred and issues rewards if applicable.
 */
export const handleJobCompletion = async (job: IJob, session?: mongoose.ClientSession) => {
    const internalSession = !session ? await mongoose.startSession() : null;
    if (internalSession) internalSession.startTransaction();

    try {
        const activeSession = session || internalSession;
        logger.info(`Processing referrals for completed job ${job._id}`);

        // 1. Check if Customer was referred
        await processReferralForUser(job.customerId.toString(), job, 'CUSTOMER', activeSession as any);

        // 2. Check if Provider was referred
        if (job.providerId) {
            await processReferralForUser(job.providerId.toString(), job, 'PROVIDER', activeSession as any);
        }

        if (internalSession) await internalSession.commitTransaction();
    } catch (error: any) {
        if (internalSession) await internalSession.abortTransaction();
        logger.error(`Referral handleJobCompletion failed: ${error.message}`);
    } finally {
        if (internalSession) internalSession.endSession();
    }
};

const processReferralForUser = async (userId: string, job: IJob, role: 'CUSTOMER' | 'PROVIDER', session?: mongoose.ClientSession) => {
    const user = await User.findById(userId).session(session as any);
    if (!user || !user.referredBy) return;

    // Admin Control: Per-Workspace Referral Switch
    const settings = await SystemSettings.findOne({ countryCode: user.countryCode }).session(session as any);
    if (settings && !settings.referralProgramEnabled) {
        logger.info(`Referral ignored: Program is disabled for workspace ${user.countryCode}`);
        return;
    }

    // Admin control: Check if referral privileges are disabled for this account
    if (user.isReferralDisabled) {
        logger.warn(`Referral ignored: User ${user._id} has referral privileges disabled.`);
        return;
    }

    const campaign = await ReferralCampaign.findOne({
        countryCode: user.countryCode,
        isActive: true,
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() }
    }).session(session as any);

    if (!campaign && !settings) {
        logger.info(`No active referral campaign or settings for workspace ${user.countryCode}`);
        return;
    }

    // Get or Create Referral Record
    let record = await ReferralRecord.findOne({
        referrerId: user.referredBy,
        referredId: user._id
    }).session(session as any);

    if (!record) {
        // Find referrer type
        let referrerType: 'USER' | 'PARTNER' = 'USER';
        let partner = await AffiliatePartner.findById(user.referredBy).session(session as any);

        if (partner) {
            referrerType = 'PARTNER';
            if (partner.status !== AffiliateStatus.ACTIVE) {
                logger.warn(`Referral ignored: Partner ${partner._id} is not active.`);
                return;
            }
        } else {
            const referrer = await User.findById(user.referredBy).session(session as any);
            if (!referrer) return;

            // Fraud Protection (Only for User referrers)
            if (referrer._id.toString() === user._id.toString()) return;
        }

        record = new ReferralRecord({
            referrerId: user.referredBy,
            referrerType,
            referredId: user._id,
            campaignId: campaign?._id,
            countryCode: user.countryCode
        });
    }

    if (record.isDisabled) return;

    // ISSUE 8: IDEMPOTENCY / Duplicate Protection
    const existingReward = await ReferralReward.findOne({
        referredId: user._id,
        jobId: job._id
    }).session(session as any);

    if (existingReward) {
        logger.warn(`Duplicate Commission Attempt Prevented | Job: ${job._id} | User: ${user._id}`);
        return;
    }

    const jobPrice = job.agreedPrice || ((job.serviceFee || 0) + (job.bookingFee || 0));
    const platformRevenue = jobPrice * ((job.serviceFeeRateSnapshot || 15) / 100);

    // ISSUE 4: Increment Counters (Update before eligibility check)
    record.jobsCompletedCount += 1;
    record.lifetimeJobValue += jobPrice;
    record.lifetimePlatformRevenue += platformRevenue;

    // Track spend/earnings based on role
    if (user.role === UserRole.CUSTOMER) {
        record.totalSpend += jobPrice;
    } else if (user.role === UserRole.PROVIDER) {
        record.lifetimeEarnings += (jobPrice - platformRevenue);
    }

    record.lastCompletedJobAt = new Date();

    // Determine Rules (Prioritize Partner Settings if referrer is a Partner)
    let minJobs = campaign?.minCompletedJobs ?? settings?.referralMinCompletedJobs ?? 1;
    let maxRewards = campaign?.maxRewardsPerReferral ?? settings?.referralMaxRewardsPerUser ?? 5;
    let rewardDelay = campaign?.rewardDelayDays ?? settings?.referralRewardDelayDays ?? 0;
    const expiryDays = settings?.referralExpiryDays ?? 0;

    // EXPIRY CHECK: If referral expired, no reward.
    if (expiryDays > 0) {
        const expiryDate = new Date(record.createdAt.getTime() + (expiryDays * 24 * 60 * 60 * 1000));
        if (new Date() > expiryDate) {
            logger.info(`Referral expired for user ${user._id}. Created at ${record.createdAt}, Expired at ${expiryDate}`);
            await record.save({ session });
            return;
        }
    }

    let baseRewardAmount = 0;
    let isRewardEnabled = true;

    if (record.referrerType === 'PARTNER') {
        const partner = await AffiliatePartner.findById(record.referrerId).session(session as any);
        if (partner && partner.commissionSettings) {
            maxRewards = partner.commissionSettings.maxRewardableJobs ?? maxRewards;

            if (user.role === UserRole.CUSTOMER) {
                baseRewardAmount = partner.commissionSettings.customerReward;
                isRewardEnabled = partner.commissionSettings.customerEnabled;
            } else if (user.role === UserRole.PROVIDER) {
                baseRewardAmount = partner.commissionSettings.providerReward;
                isRewardEnabled = partner.commissionSettings.providerEnabled;
            } else {
                baseRewardAmount = partner.commissionSettings.businessReward;
                isRewardEnabled = partner.commissionSettings.businessEnabled;
            }

            // Check if partner's custom commission model overrides baseRewardAmount
            if (partner.commissionModel === 'PERCENTAGE') {
                baseRewardAmount = (jobPrice) * (partner.commissionValue / 100);
            }
        }
    } else {
        // Fallback to global role-based rewards for non-partner referrers
        if (user.role === UserRole.CUSTOMER) baseRewardAmount = settings?.referralRewardCustomer ?? 10;
        else if (user.role === UserRole.PROVIDER) baseRewardAmount = settings?.referralRewardProvider ?? 20;
        else baseRewardAmount = settings?.referralRewardBusiness ?? 50;
    }

    const currency = (campaign?.currency ?? settings?.countryCode) || 'USD';
    const rewardType = settings?.referralRewardType || 'REFERRAL_BALANCE';

    // ISSUE 3 & 4: Eligibility check using dynamic rules
    const isEligibleForReward = isRewardEnabled && record.jobsCompletedCount >= minJobs && record.rewardsIssuedCount < maxRewards;

    if (isEligibleForReward) {
        // Create Reward Event
        const reward = new ReferralReward({
            referrerId: user.referredBy,
            referrerType: record.referrerType,
            referredId: user._id,
            jobId: job._id,
            campaignId: campaign?._id || new mongoose.Types.ObjectId(),
            amount: baseRewardAmount,
            currency: currency,
            rewardType: rewardType,
            status: ReferralStatus.PENDING,
            countryCode: user.countryCode,
            scheduledAt: new Date(Date.now() + (rewardDelay * 24 * 60 * 60 * 1000)),
            metadata: {
                rewardNumber: record.rewardsIssuedCount + 1,
                maxRewards,
                jobPrice,
                campaignTitle: campaign?.title
            }
        });

        if (rewardDelay === 0) {
            await executeRewardPayout(reward, session);
        } else {
            reward.status = ReferralStatus.QUALIFIED;
            await reward.save({ session });
        }

        record.rewardsIssuedCount += 1;
        record.totalCommissionGenerated += baseRewardAmount;
        record.lastCommissionDate = new Date();
        record.maxRewardableJobs = maxRewards; // Keep record of what the limit was

        if (record.referrerType === 'PARTNER') {
            const partner = await AffiliatePartner.findById(record.referrerId).session(session as any);
            if (partner) {
                partner.stats.completedJobs += 1;
                // Re-calculate qualified users (users with at least 1 job)
                partner.stats.qualifiedUsers = await ReferralRecord.countDocuments({
                    referrerId: partner._id,
                    jobsCompletedCount: { $gt: 0 }
                }).session(session as any);
                await partner.save({ session });
            }
        }
    }

    await record.save({ session });
};

export const executeRewardPayout = async (reward: any, session?: mongoose.ClientSession) => {
    try {
        if (reward.referrerType === 'PARTNER') {
            const partner = await AffiliatePartner.findById(reward.referrerId).session(session as any);
            if (!partner || partner.status !== AffiliateStatus.ACTIVE) {
                reward.status = ReferralStatus.REWARDED; // Mark as REWARDED anyway if it's already done but we just logged it?
                // Actually keep it pending if partner suspended.
                if (partner?.status === AffiliateStatus.SUSPENDED) {
                     reward.status = ReferralStatus.REJECTED;
                     reward.rejectionReason = 'Partner suspended.';
                     await reward.save({ session });
                     return;
                }
                return;
            }

            // Create Ledger Entry for Audit
            const transactionId = `TRX-${uuidv4().slice(0, 8).toUpperCase()}`;
            await Ledger.create([{
                transactionId,
                toUserId: partner._id, // Using toUserId for partner too, though they are in different collection
                amount: reward.amount,
                currency: reward.currency,
                countryCode: reward.countryCode,
                type: TransactionType.REFERRAL_REWARD,
                status: 'COMPLETED',
                description: `Affiliate Commission for user ${reward.referredId}`,
                metadata: { rewardId: reward._id, referrerType: 'PARTNER' }
            }], { session });

            // Partners accumulate balance in their model, not a standard wallet
            partner.balance.available += reward.amount;
            await partner.save({ session });

            reward.status = ReferralStatus.REWARDED;
            reward.processedAt = new Date();
            await reward.save({ session });

            logger.info(`Affiliate Payout successful: ${reward.amount} to partner ${partner.name}`);
        } else {
            const referrer = await User.findById(reward.referrerId).session(session as any);
            const referred = await User.findById(reward.referredId).session(session as any);
            if (!referrer || !referred) throw new Error('Referrer or Referred user not found');

            if (referrer.isReferralDisabled) {
                reward.status = ReferralStatus.DISABLED;
                reward.rejectionReason = 'Referrer privileges are disabled.';
                await reward.save({ session });
                return;
            }

            const balanceType = reward.rewardType === 'REFERRAL_BALANCE' ? 'balanceReferral' :
                               reward.rewardType === 'WALLET_CREDIT' ? 'balanceCredit' : 'balanceMain';

            await walletService.mutateWallet({
                userId: reward.referrerId.toString(),
                amount: reward.amount,
                type: TransactionType.REFERRAL_REWARD,
                balanceType: balanceType,
                description: `Referral Reward earned from ${referred.firstName}'s activity`,
                countryCode: reward.countryCode,
                currency: reward.currency,
                session,
                metadata: {
                    referredUserId: reward.referredId.toString(),
                    jobId: reward.jobId.toString(),
                    rewardType: reward.rewardType
                }
            });

            reward.status = ReferralStatus.REWARDED;
            reward.processedAt = new Date();
            await reward.save({ session });

            if (referrer.role === UserRole.PROVIDER) {
                await financialService.applyReferralBalanceToServiceFees(reward.referrerId.toString(), reward.amount, session as any);
            }

            await notificationService.notifyUser(
                reward.referrerId.toString(),
                'Referral Reward Credited!',
                `Congratulations! You have earned a reward from ${referred.firstName}'s qualifying job.`
            );

            // Dispatch Referral Reward Email
            if (referrer.email) {
                await notificationQueue.addNotificationToQueue({
                    type: 'EMAIL',
                    email: referrer.email,
                    templateCode: 'REFERRAL_REWARD_EARNED',
                    templateData: {
                        firstName: referrer.firstName,
                        referredName: referred.firstName,
                        amount: reward.amount.toString(),
                        currency: reward.currency
                    },
                    countryCode: reward.countryCode
                });
            }
        }
    } catch (error: any) {
        logger.error(`executeRewardPayout failed: ${error.message}`);
        reward.status = ReferralStatus.PENDING;
        await reward.save({ session });
    }
};

export const processScheduledRewards = async () => {
    try {
        const rewards = await ReferralReward.find({
            status: { $in: [ReferralStatus.PENDING, ReferralStatus.QUALIFIED] },
            scheduledAt: { $lte: new Date() }
        });

        for (const reward of rewards) {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                await executeRewardPayout(reward, session);
                await session.commitTransaction();
            } catch (err: any) {
                await session.abortTransaction();
            } finally {
                session.endSession();
            }
        }
    } catch (error: any) {
        logger.error(`SCHEDULER | REFERRAL | Fatal error: ${error.message}`);
    }
};

export const getReferralStats = async (userId: string) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const totalReferrals = await ReferralRecord.countDocuments({ referrerId: userId });
    const rewardHistory = await ReferralReward.find({ referrerId: userId })
        .sort({ createdAt: -1 })
        .populate('referredId', 'firstName lastName')
        .lean();

    const paidRewards = await ReferralReward.aggregate([
        { $match: { referrerId: new mongoose.Types.ObjectId(userId), status: ReferralStatus.REWARDED } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const pendingRewards = await ReferralReward.aggregate([
        { $match: { referrerId: new mongoose.Types.ObjectId(userId), status: ReferralStatus.PENDING } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const country = await Country.findOne({ code: user.countryCode });
    const currency = country?.currencySymbol || country?.currency || 'R';

    return {
        referralCode: user.referralCode,
        totalReferrals,
        paidRewards: paidRewards[0]?.total || 0,
        pendingRewards: pendingRewards[0]?.total || 0,
        currency,
        history: rewardHistory.map((r: any) => ({
            id: r._id,
            referredUser: `${r.referredId?.firstName || 'User'} ${r.referredId?.lastName || ''}`.trim(),
            jobId: r.jobId,
            completionDate: r.processedAt || r.scheduledAt,
            rewardAmount: r.amount,
            status: r.status,
            currency: r.currency || currency,
            workspace: r.countryCode,
            createdAt: r.createdAt
        }))
    };
};

export const getReferralAnalytics = async (countryCode: string) => {
    const query: any = { countryCode };
    const totalReferrals = await ReferralRecord.countDocuments(query);
    const successfulReferrals = await ReferralRecord.countDocuments({ ...query, rewardsIssuedCount: { $gt: 0 } });

    const statusBreakdown = await ReferralReward.aggregate([
        { $match: query },
        { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } }
    ]);

    const topReferrers = await ReferralRecord.aggregate([
        { $match: query },
        {
            $group: {
                _id: '$referrerId',
                totalReferrals: { $sum: 1 },
                qualifiedReferrals: { $sum: { $cond: [{ $gt: ["$jobsCompletedCount", 0] }, 1, 0] } }
            }
        },
        { $sort: { totalReferrals: -1 } },
        { $limit: 20 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'referralrewards',
                let: { rId: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ["$referrerId", "$$rId"] } } },
                    { $group: { _id: null, total: { $sum: "$amount" }, pendingCount: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } } } }
                ],
                as: 'rewardsData'
            }
        },
        { $unwind: { path: '$rewardsData', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                name: { $concat: ["$user.firstName", " ", "$user.lastName"] },
                role: "$user.role",
                workspace: "$user.countryCode",
                totalReferrals: 1,
                qualified: "$qualifiedReferrals",
                pending: { $ifNull: ["$rewardsData.pendingCount", 0] },
                rewardsEarned: { $ifNull: ["$rewardsData.total", 0] },
                lastReferral: "$user.updatedAt"
            }
        }
    ]);

    const customerRefs = await User.countDocuments({ countryCode, referredBy: { $exists: true }, role: UserRole.CUSTOMER });
    const providerRefs = await User.countDocuments({ countryCode, referredBy: { $exists: true }, role: UserRole.PROVIDER });

    const fraudAttempts = await ReferralRecord.countDocuments({ countryCode, isFraudSuspicious: true });

    const rewardsIssued = statusBreakdown.find(b => b._id === ReferralStatus.REWARDED)?.totalAmount || 0;
    const rewardsPending = (statusBreakdown.find(b => b._id === ReferralStatus.PENDING)?.totalAmount || 0) +
                           (statusBreakdown.find(b => b._id === ReferralStatus.QUALIFIED)?.totalAmount || 0);

    const rewardsRejected = statusBreakdown.find(b => b._id === ReferralStatus.REJECTED)?.totalAmount || 0;

    return {
        totalReferrals,
        successfulReferrals,
        pendingReferrals: (statusBreakdown.find(b => b._id === ReferralStatus.PENDING)?.count || 0) +
                          (statusBreakdown.find(b => b._id === ReferralStatus.QUALIFIED)?.count || 0),
        rejectedReferrals: statusBreakdown.find(b => b._id === ReferralStatus.REJECTED)?.count || 0,
        fraudAttempts,
        rewardsIssued,
        rewardsPending,
        rewardsRejected,
        averageReward: rewardsIssued / (successfulReferrals || 1),
        conversionRate: (successfulReferrals / (totalReferrals || 1)) * 100,
        customerReferrals: customerRefs,
        providerReferrals: providerRefs,
        statusBreakdown,
        topReferrers
    };
};

export const toggleUserReferralPrivileges = async (userId: string, isDisabled: boolean, adminId: string) => {
    const user = await User.findByIdAndUpdate(userId, { isReferralDisabled: isDisabled }, { new: true });
    if (!user) throw new Error('User not found');
    await ReferralRecord.updateMany({ referrerId: userId }, { isDisabled });
    return user;
};
