import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import ReferralCampaign from '../models/ReferralCampaign';
import ReferralRecord from '../models/ReferralRecord';
import ReferralReward, { ReferralStatus } from '../models/ReferralReward';
import * as walletService from './wallet.service';
import * as financialService from './financial.service';
import * as notificationService from './notification.service';
import { TransactionType } from '../models/Ledger';
import { logger } from '../utils/logger';
import { IJob } from '../models/Job';

/**
 * Triggered when a job is completed.
 * Checks if the customer or provider was referred and issues rewards if applicable.
 */
export const handleJobCompletion = async (job: IJob, session?: mongoose.ClientSession) => {
    try {
        logger.info(`Processing referrals for completed job ${job._id}`);

        // 1. Check if Customer was referred
        await processReferralForUser(job.customerId.toString(), job, 'CUSTOMER', session);

        // 2. Check if Provider was referred
        if (job.providerId) {
            await processReferralForUser(job.providerId.toString(), job, 'PROVIDER', session);
        }
    } catch (error: any) {
        logger.error(`Referral handleJobCompletion failed: ${error.message}`);
    }
};

const processReferralForUser = async (userId: string, job: IJob, role: 'CUSTOMER' | 'PROVIDER', session?: mongoose.ClientSession) => {
    const user = await User.findById(userId).session(session as any);
    if (!user || !user.referredBy) return;

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

    if (!campaign) {
        logger.info(`No active referral campaign for workspace ${user.countryCode}`);
        return;
    }

    // Get or Create Referral Record
    let record = await ReferralRecord.findOne({
        referrerId: user.referredBy,
        referredId: user._id
    }).session(session as any);

    if (!record) {
        // Fraud Protection
        const referrer = await User.findById(user.referredBy).session(session as any);
        if (!referrer) return;

        // Prevent self-referral
        if (referrer._id.toString() === user._id.toString()) {
            logger.warn(`Referral Fraud: Self-referral attempt by ${user._id}`);
            return;
        }

        // Prevent duplicate referrals using same phone
        const duplicatePhone = await User.findOne({
            phoneNumber: user.phoneNumber,
            _id: { $ne: user._id },
            referredBy: { $exists: true }
        }).session(session as any);

        if (duplicatePhone) {
            logger.warn(`Referral Fraud: Duplicate phone number ${user.phoneNumber} detected for referral.`);
            return;
        }

        // Prevent multiple accounts using same hardware
        if (user.hardwareId) {
            const duplicateHardware = await User.findOne({
                hardwareId: user.hardwareId,
                _id: { $ne: user._id },
                referredBy: { $exists: true }
            }).session(session as any);

            if (duplicateHardware) {
                logger.warn(`Referral Fraud: Duplicate hardwareId ${user.hardwareId} detected for referral.`);
                return;
            }
        }

        // Circular Referral Check (A invites B, B invites A)
        const circular = await User.findOne({ _id: user.referredBy, referredBy: user._id }).session(session as any);
        if (circular) {
            logger.warn(`Referral Fraud: Circular referral detected between ${user._id} and ${user.referredBy}`);
            return;
        }

        record = new ReferralRecord({
            referrerId: user.referredBy,
            referredId: user._id,
            campaignId: campaign._id,
            countryCode: user.countryCode
        });
    }

    if (record.isDisabled) {
        logger.info(`Referral record ${record._id} is disabled.`);
        return;
    }

    // IDEMPOTENCY: Check if this job was already rewarded
    const existingReward = await ReferralReward.findOne({
        referredId: user._id,
        jobId: job._id
    }).session(session as any);

    if (existingReward) {
        logger.info(`Job ${job._id} already rewarded for referral ${user._id}`);
        return;
    }

    // Increment completed jobs count
    record.jobsCompletedCount += 1;
    await record.save({ session });

    // Check eligibility
    if (record.jobsCompletedCount >= campaign.minCompletedJobs &&
        record.rewardsIssuedCount < campaign.maxRewardsPerReferral) {

        // Create Reward Event
        const reward = new ReferralReward({
            referrerId: user.referredBy,
            referredId: user._id,
            jobId: job._id,
            campaignId: campaign._id,
            amount: campaign.rewardAmount,
            currency: campaign.currency,
            status: ReferralStatus.PENDING,
            countryCode: user.countryCode,
            scheduledAt: new Date(Date.now() + (campaign.rewardDelayDays * 24 * 60 * 60 * 1000))
        });

        if (campaign.rewardDelayDays === 0) {
            await executeRewardPayout(reward, session);
        } else {
            reward.status = ReferralStatus.QUALIFIED; // Mark as qualified but pending delay
            await reward.save({ session });
            logger.info(`Referral reward qualified for ${reward.referredId}. Scheduled payout at ${reward.scheduledAt}`);

            // Notification: Referral Qualified
            await notificationService.notifyUser(
                user.referredBy.toString(),
                'Referral Qualified!',
                `Good news! ${user.firstName} has completed a qualifying job. Your reward of ${campaign.rewardAmount} ${campaign.currency} is being processed.`
            );
        }

        record.rewardsIssuedCount += 1;

        if (record.rewardsIssuedCount >= campaign.maxRewardsPerReferral) {
            // Notification: Referral Limit Reached
            await notificationService.notifyUser(
                user.referredBy.toString(),
                'Referral Reward Limit Reached',
                `You have received the maximum number of rewards from referring ${user.firstName}. Thank you for growing the PieceJob community!`
            );
        }

        await record.save({ session });
    }
};

export const executeRewardPayout = async (reward: any, session?: mongoose.ClientSession) => {
    try {
        const referrer = await User.findById(reward.referrerId).session(session as any);
        const referred = await User.findById(reward.referredId).session(session as any);
        if (!referrer || !referred) throw new Error('Referrer or Referred user not found');

        // Check if referral privileges are still active
        if (referrer.isReferralDisabled) {
            reward.status = ReferralStatus.DISABLED;
            reward.rejectionReason = 'Referrer privileges are disabled.';
            await reward.save({ session });
            return;
        }

        if (referrer.isBanned) {
            reward.status = ReferralStatus.REJECTED;
            reward.rejectionReason = 'Referrer is banned.';
            await reward.save({ session });
            return;
        }

        await walletService.mutateWallet({
            userId: reward.referrerId.toString(),
            amount: reward.amount,
            type: TransactionType.REFERRAL_REWARD,
            balanceType: 'balanceReferral',
            description: `Referral Reward: ${reward.amount} ${reward.currency} earned from ${referred.firstName}'s activity`,
            countryCode: reward.countryCode,
            currency: reward.currency,
            session,
            metadata: {
                referredUserId: reward.referredId.toString(),
                jobId: reward.jobId.toString(),
                campaignId: reward.campaignId.toString()
            }
        });

        reward.status = ReferralStatus.REWARDED;
        reward.processedAt = new Date();
        await reward.save({ session });

        // SECTION: Automatic Debt Clearance for Providers
        if (referrer.role === UserRole.PROVIDER) {
            await financialService.applyReferralBalanceToServiceFees(reward.referrerId.toString(), reward.amount, session as any);
        }

        logger.info(`Payout successful: ${reward.amount} ${reward.currency} to referrer ${reward.referrerId}`);

        // Notifications
        await notificationService.notifyUser(
            reward.referrerId.toString(),
            'Referral Reward Credited!',
            `Congratulations! You have earned ${reward.amount} ${reward.currency} from ${referred.firstName}'s qualifying job.`
        );

    } catch (error: any) {
        logger.error(`executeRewardPayout failed: ${error.message}`);
        reward.status = ReferralStatus.PENDING;
        await reward.save({ session });
    }
};

/**
 * SCHEDULER: Process all pending rewards that have passed their delay period.
 */
export const processScheduledRewards = async () => {
    try {
        const rewards = await ReferralReward.find({
            status: { $in: [ReferralStatus.PENDING, ReferralStatus.QUALIFIED] },
            scheduledAt: { $lte: new Date() }
        });

        if (rewards.length === 0) return;

        logger.info(`SCHEDULER | REFERRAL | Processing ${rewards.length} pending rewards.`);

        for (const reward of rewards) {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                await executeRewardPayout(reward, session);
                await session.commitTransaction();
            } catch (err: any) {
                await session.abortTransaction();
                logger.error(`SCHEDULER | REFERRAL | Failed payout for ${reward._id}: ${err.message}`);
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

    return {
        referralCode: user.referralCode,
        totalReferrals,
        paidRewards: paidRewards[0]?.total || 0,
        pendingRewards: pendingRewards[0]?.total || 0,
        history: rewardHistory.map((r: any) => ({
            id: r._id,
            referredUser: `${r.referredId?.firstName || 'User'} ${r.referredId?.lastName || ''}`.trim(),
            jobId: r.jobId,
            completionDate: r.processedAt || r.scheduledAt,
            rewardAmount: r.amount,
            status: r.status,
            workspace: r.countryCode,
            createdAt: r.createdAt
        }))
    };
};

/**
 * ADMIN: Get overall referral analytics for a workspace.
 */
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
        { $group: { _id: '$referrerId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user'
            }
        },
        { $unwind: '$user' },
        {
            $project: {
                _id: 1,
                count: 1,
                name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
                email: '$user.email'
            }
        }
    ]);

    const rewardsIssued = statusBreakdown.find(b => b._id === ReferralStatus.REWARDED)?.totalAmount || 0;
    const rewardsPending = statusBreakdown.find(b => b._id === ReferralStatus.PENDING)?.totalAmount || 0;

    return {
        totalReferrals,
        successfulReferrals,
        pendingReferrals: totalReferrals - successfulReferrals,
        rewardsIssued,
        rewardsPending,
        statusBreakdown,
        topReferrers
    };
};

/**
 * ADMIN: Disable or Enable referral privileges for a specific user.
 */
export const toggleUserReferralPrivileges = async (userId: string, isDisabled: boolean, adminId: string) => {
    const user = await User.findByIdAndUpdate(userId, { isReferralDisabled: isDisabled }, { new: true });
    if (!user) throw new Error('User not found');

    // Also disable existing referral records for this user as a referrer
    await ReferralRecord.updateMany({ referrerId: userId }, { isDisabled });

    logger.info(`ADMIN | REFERRAL_PRIVILEGES | User ${userId} | Disabled: ${isDisabled} | By Admin: ${adminId}`);

    // Notification: Referral Disabled/Enabled
    await notificationService.notifyUser(
        userId,
        isDisabled ? 'Referral Privileges Suspended' : 'Referral Privileges Restored',
        isDisabled
            ? 'Your ability to earn referral rewards has been temporarily suspended by an administrator.'
            : 'Your referral privileges have been restored. You can now invite friends and earn rewards again.'
    );

    return user;
};
