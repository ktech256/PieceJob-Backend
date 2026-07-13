import mongoose from 'mongoose';
import Payout, { PayoutStatus } from '../models/Payout';
import Ledger, { TransactionType } from '../models/Ledger';
import Wallet from '../models/Wallet';
import User from '../models/User';
import * as notificationQueue from './notification.queue';
import { v4 as uuidv4 } from 'uuid';
import AuditLog from '../models/AuditLog';

export const approvePayoutBatch = async (payoutIds: string[], adminId: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const payouts = await Payout.find({ _id: { $in: payoutIds }, status: PayoutStatus.PENDING }).session(session);

        for (const payout of payouts) {
            payout.status = PayoutStatus.APPROVED;
            payout.auditTrail.push({
                action: 'BATCH_APPROVAL',
                performedBy: adminId as any,
                timestamp: new Date(),
                note: 'Approved via batch engine'
            });
            await payout.save({ session });
        }

        await session.commitTransaction();
        return payouts;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

export const processPayoutBatch = async (payoutIds: string[], adminId: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const payouts = await Payout.find({ _id: { $in: payoutIds }, status: PayoutStatus.APPROVED }).session(session);
        const batchId = uuidv4();

        for (const payout of payouts) {
            payout.status = PayoutStatus.PROCESSING;
            payout.processedAt = new Date();
            payout.batchId = batchId;
            payout.auditTrail.push({
                action: 'BATCH_PROCESSING',
                performedBy: adminId as any,
                timestamp: new Date(),
                note: `Moved to processing batch ${batchId}`
            });
            await payout.save({ session });

            // Dedect from Main Balance (since it was moved from Escrow to Main when cleared)
            await Wallet.findOneAndUpdate(
                { userId: payout.providerId },
                { $inc: { balanceMain: -payout.totalAmount } },
                { session }
            );

            // Create Ledger record for outgoing payout
            await new Ledger({
                transactionId: `PAYOUT-${payout._id}`,
                toUserId: payout.providerId,
                amount: payout.totalAmount,
                currency: payout.currency,
                countryCode: payout.countryCode,
                type: TransactionType.PAYOUT,
                status: 'PENDING',
                metadata: { batchId }
            }).save({ session });
        }

        await session.commitTransaction();
        return { batchId, processedCount: payouts.length };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

export const markPaid = async (payoutId: string, bankRef: string, adminId: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const payout = await Payout.findById(payoutId).session(session);
        if (!payout) throw new Error('Payout not found');
        if (payout.status !== PayoutStatus.PROCESSING) throw new Error('Invalid payout state for payment');

        payout.status = PayoutStatus.PAID;
        payout.bankReference = bankRef;
        payout.auditTrail.push({
            action: 'MARK_PAID',
            performedBy: adminId as any,
            timestamp: new Date(),
            note: `Payment confirmed. Ref: ${bankRef}`
        });
        await payout.save({ session });

        await Ledger.findOneAndUpdate(
            { transactionId: `PAYOUT-${payout._id}` },
            { status: 'COMPLETED' },
            { session }
        );

        // Send Payout Completed Email
        const provider = await User.findById(payout.providerId);
        if (provider?.email) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email: provider.email,
                templateCode: 'WITHDRAWAL_COMPLETED',
                templateData: {
                    firstName: provider.firstName,
                    amount: payout.totalAmount.toString(),
                    currency: payout.currency,
                    reference: bankRef
                },
                countryCode: payout.countryCode
            });
        }

        await session.commitTransaction();
        return payout;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

export const reversePayout = async (payoutId: string, reason: string, adminId: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const payout = await Payout.findById(payoutId).session(session);
        if (!payout) throw new Error('Payout not found');

        const prevStatus = payout.status;
        payout.status = PayoutStatus.REVERSED;
        payout.failureReason = reason;
        payout.auditTrail.push({
            action: 'REVERSE',
            performedBy: adminId as any,
            timestamp: new Date(),
            note: `Reversed. Reason: ${reason}`
        });
        await payout.save({ session });

        // Credit back to wallet
        await Wallet.findOneAndUpdate(
            { userId: payout.providerId },
            { $inc: { balanceMain: payout.totalAmount } },
            { session }
        );

        await Ledger.findOneAndUpdate(
            { transactionId: `PAYOUT-${payout._id}` },
            { status: 'CANCELLED', metadata: { reversalReason: reason } },
            { session }
        );

        // Send Payout Failed Email
        const provider = await User.findById(payout.providerId);
        if (provider?.email) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email: provider.email,
                templateCode: 'WITHDRAWAL_FAILED',
                templateData: {
                    firstName: provider.firstName,
                    amount: payout.totalAmount.toString(),
                    currency: payout.currency,
                    reason: reason || 'N/A'
                },
                countryCode: payout.countryCode
            });
        }

        await session.commitTransaction();
        return payout;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};
