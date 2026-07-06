import Wallet from '../models/Wallet';
import Ledger, { TransactionType } from '../models/Ledger';
import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import CommissionRecord from '../models/ServiceFeeRecord';
import SystemSettings from '../models/SystemSettings';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as auditService from './audit.service';
import * as testUserService from './test-user.service';
import * as walletService from './wallet.service';
import { logger } from '../utils/logger';

export const handleBookingFee = async (jobId: string, customerId: string, amount: number, currency: string, countryCode: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const isTest = await testUserService.isTestUser(customerId);

    // 1. Create Ledger entry for Platform Revenue (Booking Fee)
    const ledger = new Ledger({
      transactionId: `BF-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`,
      jobId,
      fromUserId: customerId,
      amount,
      currency,
      countryCode,
      type: TransactionType.BOOKING_FEE,
      status: 'COMPLETED',
      isTestTransaction: isTest,
      description: 'Job Booking Fee'
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

export const completeJobFinancials = async (jobId: string, providerId: string, totalAmount: number, serviceFeeRate: number, currency: string, countryCode: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const isTest = await testUserService.isTestUser(providerId);

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new Error('Job not found');

    const agreedPrice = job.agreedPrice || totalAmount;
    const settings = await SystemSettings.findOne({ countryCode }).session(session) || await SystemSettings.findOne({ countryCode: 'GLOBAL' }).session(session);

    // Use stored service fee rate if available, otherwise fallback to settings
    const finalServiceFeeRate = job.serviceFeeRateSnapshot || settings?.platformServiceFeePercent || 15;
    const totalServiceFee = agreedPrice * (finalServiceFeeRate / 100);
    const bookingFeePaid = job.bookingFee || 0;
    const outstandingServiceFee = totalServiceFee - bookingFeePaid;

    // 1. Gross Earning Ledger (Informational in direct model)
    await new Ledger({
      transactionId: `GE-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`,
      jobId,
      toUserId: providerId,
      amount: agreedPrice,
      currency,
      countryCode,
      type: TransactionType.SERVICE_FEE, // Keeping enum for compatibility, but it represents Gross Earning
      status: 'COMPLETED',
      isTestTransaction: isTest,
      description: 'Job marked COMPLETED (Gross Earnings)'
    }).save({ session });

    // 2. Service Fee Ledger (Platform Revenue)
    await new Ledger({
        transactionId: `SF-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`,
        jobId,
        fromUserId: providerId,
        amount: totalServiceFee,
        currency,
        countryCode,
        type: TransactionType.COMMISSION, // Renaming terminology to Service Fee
        status: 'COMPLETED',
        isTestTransaction: isTest,
        description: `Negotiated Job: Service Fee Added (${finalServiceFeeRate}%)`
    }).save({ session });

    // 3. Create Service Fee Record
    const serviceFeeRecord = new CommissionRecord({
        jobId,
        providerId,
        customerId: job.customerId,
        acceptedPrice: agreedPrice,
        serviceFeePercentage: finalServiceFeeRate,
        serviceFeeAmount: totalServiceFee,
        bookingFeePaid: bookingFeePaid,
        outstandingBalance: outstandingServiceFee,
        status: outstandingServiceFee <= 0 ? 'PAID' : 'OUTSTANDING',
        countryCode,
        currency,
        timeline: [
            { event: 'JOB_COMPLETED', timestamp: new Date() },
            { event: 'SERVICE_FEE_CALCULATED', timestamp: new Date(), metadata: { serviceFeeAmount: totalServiceFee, bookingFeePaid } }
        ]
    });
    await serviceFeeRecord.save({ session });

    // 4. Update Provider Wallet Service Fee Balance
    const wallet = await Wallet.findOneAndUpdate(
        { userId: providerId },
        { $inc: { serviceFeeBalance: outstandingServiceFee } },
        { session, new: true, upsert: true }
    );

    // 5. Suspension Logic
    const suspensionThreshold = settings?.serviceFeeSuspensionThreshold || 100;
    if (settings?.autoSuspendEnabled && wallet.serviceFeeBalance > suspensionThreshold) {
        wallet.status = 'SUSPENDED';
        wallet.isSuspended = true;
        wallet.suspendReason = `Outstanding service fee (${wallet.serviceFeeBalance}) exceeds threshold (${suspensionThreshold})`;
        await wallet.save({ session });

        await auditService.logAdminAction({
            countryCode,
            adminId: 'SYSTEM',
            adminRole: 'SYSTEM',
            action: 'PROVIDER_AUTO_SUSPEND',
            entityType: 'Provider',
            entityId: providerId,
            afterState: { status: 'SUSPENDED', serviceFeeBalance: wallet.serviceFeeBalance },
            ipAddress: 'System',
            systemSource: 'CORE_ENGINE'
        });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const refundJob = async (jobId: string, reason: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const job = await Job.findById(jobId).session(session);
        if (!job) throw new Error('Job not found');
        if (job.paymentStatus !== 'PAID') throw new Error('Job is not paid');

        const bookingFeeLedger = await Ledger.findOne({ jobId, type: TransactionType.BOOKING_FEE }).session(session);
        const serviceFeeLedger = await Ledger.findOne({ jobId, type: TransactionType.SERVICE_FEE }).session(session);

        const totalToRefund = (bookingFeeLedger?.amount || 0) + (serviceFeeLedger?.amount || 0);

        if (totalToRefund <= 0) throw new Error('Nothing to refund');

        // Refund to Customer (balanceCredit for now, or record as outward signal)
        await walletService.mutateWallet({
            userId: job.customerId.toString(),
            amount: totalToRefund,
            type: TransactionType.REFUND,
            balanceType: 'balanceCredit',
            description: `Refund for Job #${jobId.slice(-6)}: ${reason}`,
            jobId,
            countryCode: job.countryCode,
            currency: job.pricingSnapshot?.currencyCode || 'USD',
            session,
            metadata: { refundReason: reason }
        });

        // If provider was already paid or funds are in escrow, we need to claw back
        if (job.providerId) {
            const providerNetLedger = await Ledger.findOne({ jobId, toUserId: job.providerId, type: TransactionType.SERVICE_FEE }).session(session);
            const commissionLedger = await Ledger.findOne({ jobId, fromUserId: job.providerId, type: TransactionType.COMMISSION }).session(session);

            if (providerNetLedger) {
                const netAmount = providerNetLedger.amount - (commissionLedger?.amount || 0);

                // Determine if funds are in Main or Escrow
                const wallet = await Wallet.findOne({ userId: job.providerId }).session(session);
                const balanceToDeduct = (wallet?.balanceEscrow || 0) >= netAmount ? 'balanceEscrow' : 'balanceMain';

                await walletService.mutateWallet({
                    userId: job.providerId.toString(),
                    amount: -netAmount,
                    type: TransactionType.REFUND,
                    balanceType: balanceToDeduct,
                    description: `Reversal: Refund issued to customer for Job #${jobId.slice(-6)}`,
                    jobId,
                    countryCode: job.countryCode,
                    currency: providerNetLedger.currency,
                    session
                });
            }
        }

        job.paymentStatus = 'REFUNDED';
        job.status = JobStatus.CANCELLED;
        await job.save({ session });

        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

import * as settingsService from './settings.service';

import * as referralService from './referral.service';

export const releaseEscrowFunds = async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const settings = await settingsService.getSettings('GLOBAL');
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
        const commissionEntry = await Ledger.findOne({ jobId: job._id, type: TransactionType.COMMISSION });

        // Only attempt wallet movement if a commission entry exists (indicating non-direct payment model)
        if (ledgerEntry && job.providerId && commissionEntry) {
            const netAmount = ledgerEntry.amount - (commissionEntry?.amount || 0);

            // Move from Escrow to Main Balance
            await walletService.mutateWallet({
                userId: job.providerId.toString(),
                amount: -netAmount,
                type: TransactionType.SERVICE_FEE,
                balanceType: 'balanceEscrow',
                description: `Release to main balance (Job #${job._id.toString().slice(-6)})`,
                jobId: job._id.toString(),
                countryCode: job.countryCode,
                currency: ledgerEntry.currency,
                session,
                metadata: { settlement: 'ESCROW_RELEASE' }
            });

            await walletService.mutateWallet({
                userId: job.providerId.toString(),
                amount: netAmount,
                type: TransactionType.SERVICE_FEE,
                balanceType: 'balanceMain',
                description: `Job Payment Received (Job #${job._id.toString().slice(-6)})`,
                jobId: job._id.toString(),
                countryCode: job.countryCode,
                currency: ledgerEntry.currency,
                session,
                metadata: { settlement: 'ESCROW_RELEASE' }
            });
        }

        // REFERRAL REWARD - Still process this as it encourages growth
        await referralService.processReferralReward(job.customerId.toString(), session);

        job.status = JobStatus.CLOSED;
        await job.save({ session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    logger.error('Escrow release failed:', error);
  } finally {
    session.endSession();
  }
};
