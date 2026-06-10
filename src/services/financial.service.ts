import Wallet from '../models/Wallet';
import Ledger, { TransactionType } from '../models/Ledger';
import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export const handleBookingFee = async (jobId: string, customerId: string, amount: number, currency: string, countryCode: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1. Create Ledger entry for Platform Revenue (Booking Fee)
    const ledger = new Ledger({
      transactionId: uuidv4(),
      jobId,
      fromUserId: customerId,
      amount,
      currency,
      countryCode,
      type: TransactionType.BOOKING_FEE,
      status: 'COMPLETED'
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
      status: 'COMPLETED'
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
      status: 'COMPLETED'
    }).save({ session });

    // 3. Move to Escrow
    await Wallet.findOneAndUpdate(
      { userId: providerId },
      { $inc: { balanceEscrow: providerNet } },
      { session, upsert: true }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const releaseEscrowFunds = async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 12-hour window rule
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    // Find jobs completed more than 12h ago that haven't been settled yet
    // In a production system, we'd use a more robust 'settlementStatus' field
    const jobsToSettle = await Job.find({
      status: JobStatus.COMPLETED,
      completedAt: { $lt: twelveHoursAgo },
      paymentStatus: 'PAID'
    });

    for (const job of jobsToSettle) {
        // Logic to move funds from Escrow to Main wallet for the provider
        // This requires fetching the specific amount from the Ledger or Job
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
                    { $inc: { balanceReferral: 10 } }, // Reward amount (configurable)
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
