import Wallet from '../models/Wallet';
import Ledger, { TransactionType } from '../models/Ledger';
import Job, { JobStatus, IJob } from '../models/Job';
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

export const completeJobFinancials = async (jobOrId: string | IJob, providerId: string, totalAmount: number, serviceFeeRate: number, currency: string, countryCode: string, existingSession?: mongoose.ClientSession) => {
  const session = existingSession || await mongoose.startSession();
  if (!existingSession) session.startTransaction();
  try {
    const isTest = await testUserService.isTestUser(providerId);

    // 1. Get Job Document
    let job: IJob | null;
    if (typeof jobOrId === 'string') {
        job = await Job.findById(jobOrId).session(session);
    } else {
        job = jobOrId;
    }

    if (!job) throw new Error('Job not found');

    // FORENSIC: Ensure we have countryCode and currency
    let finalCountryCode = countryCode || job.countryCode;
    let finalCurrency = currency || job.pricingSnapshot?.currencyCode || 'USD';

    if (!finalCountryCode || finalCountryCode === "") {
        // Fallback to provider or customer countryCode
        logger.warn(`FINANCIALS | countryCode missing for Job: ${job._id}. Attempting user-level recovery.`);
        const user = await mongoose.model('User').findById(providerId || job.customerId).session(session as any);
        if (user && user.countryCode) {
            finalCountryCode = user.countryCode;
        }
    }

    if (!finalCountryCode || finalCountryCode === "") {
        logger.error(`FINANCIALS | FATAL | countryCode still missing after recovery attempts | Job: ${job._id}`);
        throw new Error('FINANCIALS_ERROR: countryCode is missing from payload, job document, and user profile.');
    }

    // 1.1 IDEMPOTENCY CHECK: Check if financial records already exist for this job
    const existingRecord = await CommissionRecord.findOne({ jobId: job._id }).session(session);
    if (existingRecord) {
        logger.warn(`FINANCIALS | SKIP | Records already exist for Job: ${job._id}`);
        // Do NOT commit here if session was provided by caller
        if (!existingSession) await session.commitTransaction();
        return;
    }

    const settings = await SystemSettings.findOne({ countryCode: finalCountryCode }).session(session) || await SystemSettings.findOne({ countryCode: 'GLOBAL' }).session(session);

    let agreedPrice = 0;
    let totalServiceFee = 0;
    let bookingFeePaid = job.bookingFee || 0;
    let outstandingServiceFee = 0;

    // Priority: 1. Snapshot taken at acceptance, 2. Dashboard Setting, 3. Fallback to 15%
    let finalServiceFeeRate = job.serviceFeeRateSnapshot || settings?.platformServiceFeePercent || 15;

    const isNegotiated = job.priceNegotiationRequired !== false;

    if (isNegotiated) {
        // SCENARIO A: Negotiated Job
        agreedPrice = job.agreedPrice || totalAmount;
        totalServiceFee = agreedPrice * (finalServiceFeeRate / 100);
        outstandingServiceFee = totalServiceFee - bookingFeePaid;
    } else {
        // SCENARIO B: Fixed Price Job
        // Booking Fee = Entire Platform Service Fee
        agreedPrice = 0; // "N/A" representation for numeric field
        totalServiceFee = bookingFeePaid;
        outstandingServiceFee = 0;
        finalServiceFeeRate = 0; // Not applicable
    }

    // 1. Gross Earning Ledger (Informational)
    // Recorded for all completed jobs to track provider earnings
    const grossAmount = isNegotiated ? agreedPrice : (job.serviceFee || 0) + bookingFeePaid;

    await new Ledger({
        transactionId: `GE-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`,
        jobId: job._id,
        toUserId: providerId,
        amount: grossAmount,
        currency: finalCurrency,
        countryCode: finalCountryCode,
        type: TransactionType.SERVICE_FEE,
        status: 'COMPLETED',
        isTestTransaction: isTest,
        description: isNegotiated
            ? `Negotiated Job: Gross Earnings (${finalCurrency} ${grossAmount})`
            : `Fixed Price Job: Gross Earnings (${finalCurrency} ${grossAmount})`
    }).save({ session });

    // 2. Service Fee Ledger (Platform Revenue)
    await new Ledger({
        transactionId: `SF-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`,
        jobId: job._id,
        fromUserId: providerId,
        amount: totalServiceFee,
        currency: finalCurrency,
        countryCode: finalCountryCode,
        type: TransactionType.COMMISSION, // Platform Service Fee
        status: 'COMPLETED',
        isTestTransaction: isTest,
        description: isNegotiated
            ? `Negotiated Job: Service Fee (${finalServiceFeeRate}%)`
            : `Fixed Price Job: Booking Fee as Service Fee`
    }).save({ session });

    // 3. Create Service Fee Record
    const serviceFeeRecord = new CommissionRecord({
        jobId: job._id,
        providerId,
        customerId: job.customerId,
        acceptedPrice: isNegotiated ? agreedPrice : 0, // 0 for Fixed Price
        serviceFeePercentage: isNegotiated ? finalServiceFeeRate : 0,
        serviceFeeAmount: totalServiceFee,
        bookingFeePaid: bookingFeePaid,
        outstandingBalance: Math.max(0, outstandingServiceFee),
        status: outstandingServiceFee <= 0 ? 'PAID' : 'OUTSTANDING',
        countryCode: finalCountryCode,
        currency: finalCurrency,
        timeline: [
            { event: 'JOB_COMPLETED', timestamp: new Date() },
            { event: 'SERVICE_FEE_CALCULATED', timestamp: new Date(), metadata: { serviceFeeAmount: totalServiceFee, bookingFeePaid, isNegotiated } }
        ]
    });
    await serviceFeeRecord.save({ session });

    // 4. Update Provider Wallet (Running Account Logic)
    let wallet = await Wallet.findOne({ userId: providerId }).session(session);
    if (!wallet) {
        wallet = new Wallet({
            userId: providerId,
            countryCode: finalCountryCode,
            currency: finalCurrency,
            balanceMain: 0,
            balanceEscrow: 0,
            balanceCredit: 0,
            balanceReferral: 0,
            balanceBonus: 0,
            serviceFeeBalance: 0
        });
    }

    // All Service Fee debt is immediately transferred to the running balance (balanceCredit)
    // This maintains the single running account where the Wallet reflects the final balance.
    if (outstandingServiceFee > 0) {
        const initialCredit = wallet.balanceCredit;

        // Transfer the fee to the running account balance
        wallet.balanceCredit -= outstandingServiceFee;

        // Determine how much of this was settled by existing positive credit vs increasing debt
        const appliedFromCredit = Math.min(Math.max(0, initialCredit), outstandingServiceFee);
        const debtTransferred = outstandingServiceFee - appliedFromCredit;

        if (appliedFromCredit > 0) {
            // Record Ledger for Automatic Consumption (Auditable)
            await new Ledger({
                transactionId: `AC-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`,
                jobId: job._id,
                fromUserId: providerId,
                amount: appliedFromCredit,
                currency: finalCurrency,
                countryCode: finalCountryCode,
                type: TransactionType.SERVICE_FEE,
                status: 'COMPLETED',
                isTestTransaction: isTest,
                description: `Automatic Credit Application (Job #${job._id.toString().slice(-6)})`,
                metadata: {
                    previousCredit: initialCredit,
                    applied: appliedFromCredit,
                    remainingJobDebt: 0 // Job debt is now 0 as it's transferred
                }
            }).save({ session });
        }

        // Mark the Job Record as PAID immediately because it's been transferred to the running account
        // This satisfies the requirement that historical records shouldn't represent active debt.
        serviceFeeRecord.outstandingBalance = 0;
        serviceFeeRecord.status = 'PAID';
        serviceFeeRecord.timeline.push({
            event: 'TRANSFERRED_TO_RUNNING_ACCOUNT',
            timestamp: new Date(),
            metadata: {
                amount: outstandingServiceFee,
                appliedFromCredit,
                debtTransferred,
                newWalletCredit: wallet.balanceCredit
            }
        });
        await serviceFeeRecord.save({ session });
    }

    // Legacy sync: serviceFeeBalance tracks debt (negative)
    wallet.serviceFeeBalance = Math.min(0, wallet.balanceCredit);

    // SELF-HEALING: Repair missing config
    if (!wallet.countryCode || wallet.countryCode === "") wallet.countryCode = finalCountryCode;
    if (!wallet.currency) wallet.currency = finalCurrency;

    await wallet.save({ session });

    // 5. Suspension Logic (using legacy field for consistency)
    const suspensionThreshold = settings?.serviceFeeSuspensionThreshold || 100;
    if (settings?.autoSuspendEnabled && wallet.serviceFeeBalance < -suspensionThreshold) {
        wallet.status = 'SUSPENDED';
        wallet.isSuspended = true;
        wallet.suspendReason = `Outstanding service fee (${Math.abs(wallet.serviceFeeBalance)}) exceeds threshold (${suspensionThreshold})`;
        await wallet.save({ session });

        await auditService.logAdminAction({
            countryCode: finalCountryCode,
            adminId: 'SYSTEM',
            adminRole: 'SYSTEM',
            action: 'PROVIDER_AUTO_SUSPEND',
            entityType: 'Provider',
            entityId: providerId,
            afterState: { status: 'SUSPENDED', serviceFeeBalance: wallet.serviceFeeBalance },
            ipAddress: 'System',
            systemSource: 'CORE_ENGINE'
        }, session);
    }


    if (!existingSession) await session.commitTransaction();
    logger.info(`FINANCIALS | COMPLETED | Job: ${job._id} | Negotiated: ${isNegotiated} | Outstanding: ${outstandingServiceFee}`);
  } catch (error) {
    if (!existingSession) await session.abortTransaction();
    logger.error(`FINANCIALS | FAILED | Job: ${typeof jobOrId === 'string' ? jobOrId : jobOrId._id} | Error: ${error}`);
    throw error;
  } finally {
    if (!existingSession) session.endSession();
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

/**
 * Automatically reconciles any credit amount against outstanding service fee records.
 * This implements the single running account logic where credits must first settle existing debt.
 */
export const reconcileProviderCredit = async (providerId: string, amountToApply: number, session: mongoose.ClientSession, metadata: any = {}) => {
    if (amountToApply <= 0) return;

    const records = await CommissionRecord.find({
        providerId: new mongoose.Types.ObjectId(providerId),
        status: { $in: ['OUTSTANDING', 'PARTIAL'] }
    }).sort({ createdAt: 1 }).session(session);

    let remaining = amountToApply;
    for (const record of records) {
        if (remaining <= 0) break;

        const toPay = Math.min(record.outstandingBalance, remaining);
        record.outstandingBalance -= toPay;
        remaining -= toPay;
        record.status = record.outstandingBalance <= 0 ? 'PAID' : 'PARTIAL';

        record.timeline.push({
            event: 'CREDIT_AUTO_APPLIED',
            timestamp: new Date(),
            metadata: {
                amount: toPay,
                remaining: record.outstandingBalance,
                source: metadata.source || 'MANUAL_ADJUSTMENT'
            }
        });

        await record.save({ session });

        // Ledger for Automatic Credit Consumption (Auditable)
        await new Ledger({
            transactionId: `AC-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`,
            jobId: record.jobId,
            fromUserId: providerId,
            amount: toPay,
            currency: record.currency || metadata.currency || 'USD',
            countryCode: record.countryCode || metadata.countryCode || 'GLOBAL',
            type: TransactionType.SERVICE_FEE,
            status: 'COMPLETED',
            description: `Automatic Credit Application (${metadata.description || 'Credit applied to Job'} #${record.jobId.toString().slice(-6)})`,
            metadata: {
                ...metadata,
                applied: toPay,
                remainingRecordDebt: record.outstandingBalance
            }
        }).save({ session });
    }

    // After reconciliation, check if the provider can be unsuspended
    const wallet = await Wallet.findOne({ userId: new mongoose.Types.ObjectId(providerId) }).session(session);
    if (wallet && wallet.isSuspended) {
        const settings = await SystemSettings.findOne({ countryCode: wallet.countryCode }).session(session) || await SystemSettings.findOne({ countryCode: 'GLOBAL' }).session(session);
        if (settings?.autoUnsuspendEnabled) {
            const threshold = settings?.serviceFeeSuspensionThreshold || 100;
            if (wallet.serviceFeeBalance >= -threshold) {
                wallet.status = 'ACTIVE';
                wallet.isSuspended = false;
                wallet.suspendReason = undefined;
                await wallet.save({ session });

                await auditService.logAdminAction({
                    countryCode: wallet.countryCode,
                    adminId: 'SYSTEM',
                    adminRole: 'SYSTEM',
                    action: 'PROVIDER_AUTO_UNSUSPEND',
                    entityType: 'Provider',
                    entityId: providerId,
                    afterState: { status: 'ACTIVE', serviceFeeBalance: wallet.serviceFeeBalance },
                    ipAddress: 'System',
                    systemSource: 'CORE_ENGINE'
                }, session);
            }
        }
    }

    return remaining;
}
