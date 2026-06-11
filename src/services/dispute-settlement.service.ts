import mongoose from 'mongoose';
import SupportTicket, { TicketStatus } from '../models/SupportTicket';
import Job, { JobStatus } from '../models/Job';
import Wallet from '../models/Wallet';
import Ledger, { TransactionType } from '../models/Ledger';
import { v4 as uuidv4 } from 'uuid';
import AuditLog from '../models/AuditLog';

export const settleEscrow = async (
    ticketId: string,
    decision: 'RELEASE_TO_CUSTOMER' | 'RELEASE_TO_PROVIDER' | 'SPLIT_SETTLEMENT' | 'MANUAL_OVERRIDE',
    customerAmount: number,
    providerAmount: number,
    reason: string,
    adminId: string
) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const ticket = await SupportTicket.findById(ticketId).session(session);
        if (!ticket) throw new Error('Ticket not found');
        if (!ticket.jobId) throw new Error('Ticket is not linked to a job');

        const job = await Job.findById(ticket.jobId).session(session);
        if (!job) throw new Error('Job not found');

        // Verify total matches escrow if not manual override
        const totalAmount = customerAmount + providerAmount;
        // In our system, Service Fee (job.serviceFee) is the part that goes into provider escrow
        const escrowPart = job.serviceFee || 0;

        if (decision !== 'MANUAL_OVERRIDE' && Math.abs(totalAmount - escrowPart) > 0.01) {
            throw new Error(`Settlement mismatch. Total ${totalAmount} must equal Escrow ${escrowPart}`);
        }

        // 1. Update Wallet Balances
        if (customerAmount > 0) {
            await Wallet.findOneAndUpdate(
                { userId: job.customerId },
                { $inc: { balanceMain: customerAmount } },
                { session }
            );

            await new Ledger({
                transactionId: uuidv4(),
                jobId: job._id,
                toUserId: job.customerId,
                amount: customerAmount,
                currency: job.countryCode === 'ZA' ? 'ZAR' : 'USD', // Simplified
                countryCode: job.countryCode,
                type: TransactionType.REFUND,
                status: 'COMPLETED',
                metadata: { ticketId, decision, reason }
            }).save({ session });
        }

        if (providerAmount > 0 && job.providerId) {
            await Wallet.findOneAndUpdate(
                { userId: job.providerId },
                { $inc: { balanceMain: providerAmount } },
                { session }
            );

            await new Ledger({
                transactionId: uuidv4(),
                jobId: job._id,
                toUserId: job.providerId,
                amount: providerAmount,
                currency: job.countryCode === 'ZA' ? 'ZAR' : 'USD',
                countryCode: job.countryCode,
                type: TransactionType.SERVICE_FEE, // Releasing from escrow to main
                status: 'COMPLETED',
                metadata: { ticketId, decision, reason }
            }).save({ session });
        }

        // 2. Update Ticket
        ticket.escrowSettlement = {
            customerAmount,
            providerAmount,
            decision,
            reason,
            processedAt: new Date()
        };
        ticket.status = TicketStatus.RESOLVED;
        ticket.timeline.push({
            status: TicketStatus.RESOLVED,
            adminId: adminId as any,
            action: 'ESCROW_SETTLEMENT',
            reason: `${decision}: ${reason}`,
            timestamp: new Date()
        });
        await ticket.save({ session });

        // 3. Update Job
        job.status = JobStatus.CLOSED; // Or remain DISPUTED if still under review, but usually settlement closes it
        await job.save({ session });

        // 4. Audit Log
        await AuditLog.create([{
            adminId,
            action: 'DISPUTE_SETTLEMENT',
            targetId: ticketId,
            targetCollection: 'SupportTickets',
            newValue: { decision, customerAmount, providerAmount, reason },
            ipAddress: 'System'
        }], { session });

        await session.commitTransaction();
        return { success: true };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};
