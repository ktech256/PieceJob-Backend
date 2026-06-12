import Wallet from '../models/Wallet';
import Ledger, { TransactionType } from '../models/Ledger';
import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as auditService from './audit.service';
import * as testUserService from './test-user.service';

export const handleBookingFee = async (jobId: string, customerId: string, amount: number, currency: string, countryCode: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const isTest = await testUserService.isTestUser(customerId);

    // 1. Create Ledger entry for Platform Revenue (Booking Fee)
    const ledger = new Ledger({
      transactionId: uuidv4(),
      jobId,
      fromUserId: customerId,
      amount,
      currency,
      countryCode,
      type: TransactionType.BOOKING_FEE,
      status: 'COMPLETED',
      isTestTransaction: isTest
    });
    await ledger.save({ session });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const completeJobFinancials = async (jobId: string, providerId: string, totalAmount: number, commissionRate: number, currency: string, countryCode: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const isTest = await testUserService.isTestUser(providerId);
    const commissionAmount = totalAmount * (commissionRate / 100);
    const providerNet = totalAmount - commissionAmount;

    // 1. Service Fee Ledger
    await new Ledger({
      transactionId: uuidv4(),
      jobId,
      toUserId: providerId,
      amount: totalAmount,
      currency,
      countryCode,
      type: TransactionType.SERVICE_FEE,
      status: 'COMPLETED',
      isTestTransaction: isTest
    }).save({ session });

    // 2. Commission Ledger
    await new Ledger({
      transactionId: uuidv4(),
      jobId,
      fromUserId: providerId,
      amount: commissionAmount,
      currency,
      countryCode,
      type: TransactionType.COMMISSION,
      status: 'COMPLETED',
      isTestTransaction: isTest
    }).save({ session });

    // 3. Move to Escrow
    const wallet = await Wallet.findOneAndUpdate(
      { userId: providerId },
      { $inc: { balanceEscrow: providerNet } },
      { session, upsert: true, new: true }
    );

    // Audit Log (Financial Mutation)
    await auditService.logFinancialMutation({
        countryCode,
        userId: providerId,
        action: 'ESCROW_CREDIT',
        financialInfo: {
            transactionId: `ESC-${jobId}`,
            jobId,
            walletType: 'balanceEscrow',
            mutationType: 'CREDIT',
            amountBase: providerNet,
            amountUSD: providerNet,
            currency,
            previousBalance: (wallet?.balanceEscrow || 0) - providerNet,
            newBalance: wallet?.balanceEscrow || 0
        },
        systemSource: 'API'
    }, session);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

import * as settingsService from './settings.service';

export const releaseEscrowFunds = async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const settings = await settingsService.getSettings('GLOBAL'); // Or per-job country
    const twelveHoursAgo = new Date(Date.now() - settings.escrowCoolingPeriodHours * 60 * 60 * 1000);

    const jobsToSettle = await Job.find({
      status: JobStatus.COMPLETED,
      completedAt: { $lt: twelveHoursAgo },
      paymentStatus: 'PAID',
      escrowStatus: { $ne: 'ESCROW_HOLD_REVIEW' }
    });

    for (const job of jobsToSettle) {
        const countrySettings = await settingsService.getSettings(job.countryCode);
        const ledgerEntry = await Ledger.findOne({ jobId: job._id, type: TransactionType.SERVICE_FEE });
        if (ledgerEntry && job.providerId) {
            const commissionEntry = await Ledger.findOne({ jobId: job._id, type: TransactionType.COMMISSION });
            const netAmount = ledgerEntry.amount - (commissionEntry?.amount || 0);

            await Wallet.findOneAndUpdate(
                { userId: job.providerId },
                {
                    $inc: {
                        balanceEscrow: -netAmount,
                        balanceMain: netAmount
                    }
                },
                { session }
            );

            // SECTION 15.1: Referral Reward Unlock - Post first completion
            const customer = await User.findById(job.customerId);
            if (customer && customer.referredBy && !customer.isReferralRewardClaimed) {
                await Wallet.findOneAndUpdate(
                    { userId: customer.referredBy },
                    { $inc: { balanceReferral: countrySettings.referralRewardAmount } },
                    { session }
                );
                customer.isReferralRewardClaimed = true;
                await customer.save({ session });
            }

            // Mark job as CLOSED once financials are settled
            job.status = JobStatus.CLOSED;
            await job.save({ session });
        }
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Escrow release failed:', error);
  } finally {
    session.endSession();
  }
};
