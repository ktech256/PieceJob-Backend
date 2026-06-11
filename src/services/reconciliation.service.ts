import mongoose from 'mongoose';
import Ledger, { TransactionType } from '../models/Ledger';
import Job, { JobStatus } from '../models/Job';
import Wallet from '../models/Wallet';
import { emitAdminUpdate } from '../socket/socket.service';

export const reconcileJob = async (jobId: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const job = await Job.findById(jobId);
        if (!job) throw new Error('Job not found');

        const ledgerEntries = await Ledger.find({ jobId: job._id, status: 'COMPLETED' });

        const serviceFee = ledgerEntries.find(e => e.type === TransactionType.SERVICE_FEE)?.amount || 0;
        const commission = ledgerEntries.find(e => e.type === TransactionType.COMMISSION)?.amount || 0;

        const providerNet = serviceFee - commission;

        if (providerNet <= 0 && serviceFee > 0) {
             throw new Error('Reconciliation Error: Negative or zero net earnings on paid job');
        }

        await session.commitTransaction();
        return { success: true, jobId };
    } catch (error: any) {
        await session.abortTransaction();
        emitAdminUpdate('reconciliation_error', { jobId, error: error.message });
        return { success: false, jobId, error: error.message };
    } finally {
        session.endSession();
    }
};

export const runFullReconciliation = async (countryCode: string) => {
    const results = {
        scannedJobs: 0,
        errors: [] as any[],
        walletMismatches: [] as any[]
    };

    const jobs = await Job.find({ countryCode, status: JobStatus.COMPLETED });
    results.scannedJobs = jobs.length;

    for (const job of jobs) {
        const res = await reconcileJob((job._id as any).toString());
        if (!res.success) {
            results.errors.push(res);
        }
    }

    // Wallet Reconciliation
    const wallets = await Wallet.find({ countryCode });
    for (const wallet of wallets) {
        const totalEarnings = await Ledger.aggregate([
            { $match: { toUserId: wallet.userId, status: 'COMPLETED', type: TransactionType.SERVICE_FEE } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalCommission = await Ledger.aggregate([
            { $match: { fromUserId: wallet.userId, status: 'COMPLETED', type: TransactionType.COMMISSION } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalPayouts = await Ledger.aggregate([
            { $match: { toUserId: wallet.userId, status: 'COMPLETED', type: TransactionType.PAYOUT } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const expectedBalance = (totalEarnings[0]?.total || 0) - (totalCommission[0]?.total || 0) - (totalPayouts[0]?.total || 0);
        const actualBalance = wallet.balanceMain + wallet.balanceEscrow;

        if (Math.abs(expectedBalance - actualBalance) > 0.01) {
            results.walletMismatches.push({
                userId: wallet.userId,
                expected: expectedBalance,
                actual: actualBalance,
                diff: expectedBalance - actualBalance
            });
        }
    }

    return results;
};
