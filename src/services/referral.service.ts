import mongoose from 'mongoose';
import User from '../models/User';
import ReferralCampaign from '../models/ReferralCampaign';
import * as walletService from './wallet.service';
import { TransactionType } from '../models/Ledger';
import { logger } from '../utils/logger';

export const processReferralReward = async (newUserId: string, session?: mongoose.ClientSession) => {
    try {
        const user = await User.findById(newUserId).session(session as any);
        if (!user || !user.referredBy || user.isReferralRewardClaimed) return;

        const campaign = await ReferralCampaign.findOne({
            countryCode: user.countryCode,
            isActive: true,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() }
        }).session(session as any);

        if (!campaign) {
            logger.warn(`No active referral campaign found for workspace ${user.countryCode}`);
            return;
        }

        // Fulfill Reward to Referrer
        await walletService.mutateWallet({
            userId: user.referredBy.toString(),
            amount: campaign.rewardAmount,
            type: TransactionType.REFERRAL_REWARD,
            balanceType: 'balanceReferral',
            description: `Referral Reward: ${user.firstName} completed their first engagement`,
            countryCode: user.countryCode,
            currency: campaign.currency,
            session,
            metadata: { referredUserId: newUserId, campaignId: campaign._id }
        });

        user.isReferralRewardClaimed = true;
        await user.save({ session });

        logger.info(`Referral reward of ${campaign.rewardAmount} ${campaign.currency} fulfilled to ${user.referredBy} for user ${newUserId}`);
    } catch (error: any) {
        logger.error(`Referral processing failed: ${error.message}`);
        // Don't throw, we don't want to break the main job flow if referral fails
    }
};
