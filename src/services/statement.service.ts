import Statement, { StatementType } from '../models/Statement';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
import mongoose from 'mongoose';

export const generateStatement = async (userId: string, userType: 'CUSTOMER' | 'PROVIDER', type: StatementType, start: Date, end: Date, countryCode: string) => {
    // 1. Fetch relevant ledger entries
    const query: any = {
        countryCode,
        status: 'COMPLETED',
        createdAt: { $gte: start, $lte: end }
    };

    if (userType === 'CUSTOMER') {
        query.fromUserId = new mongoose.Types.ObjectId(userId);
    } else {
        query.toUserId = new mongoose.Types.ObjectId(userId);
    }

    const logs = await Ledger.find(query).sort({ createdAt: 1 });

    // 2. Aggregate summary
    const summary: any = { jobCount: 0, payoutCount: 0 };
    if (userType === 'PROVIDER') {
        const gross = logs.filter(l => l.type === TransactionType.SERVICE_FEE).reduce((acc, curr) => acc + curr.amount, 0);
        const serviceFee = logs.filter(l => l.type === TransactionType.COMMISSION).reduce((acc, curr) => acc + curr.amount, 0);
        summary.grossEarnings = gross;
        summary.platformServiceFee = serviceFee;
        summary.netEarnings = gross - serviceFee;
        summary.jobCount = logs.filter(l => l.type === TransactionType.SERVICE_FEE).length;
        summary.payoutCount = logs.filter(l => l.type === TransactionType.PAYOUT).length;
    } else {
        summary.totalExpenditure = logs.reduce((acc, curr) => acc + curr.amount, 0);
        summary.jobCount = logs.filter(l => l.type === TransactionType.BOOKING_FEE).length;
    }

    // 3. Create Statement record
    const statement = new Statement({
        userId,
        userType,
        type,
        periodStart: start,
        periodEnd: end,
        summary,
        details: logs.map(l => ({
            date: l.createdAt,
            jobId: l.jobId,
            transactionId: l.transactionId,
            description: `${l.type} - ${l.metadata?.note || ''}`,
            amount: l.amount,
            type: l.type
        })),
        countryCode
    });

    // 4. PDF Generation Logic (Stub for production wiring)
    // In a real production environment, we'd use 'pdfmake' or 'puppeteer'
    statement.pdfUrl = `https://cdn.piecejob.com/statements/${statement._id}.pdf`;

    await statement.save();
    return statement;
};

export const listStatements = async (userId: string, userType: 'CUSTOMER' | 'PROVIDER', countryCode: string) => {
    return Statement.find({ userId, userType, countryCode }).sort({ periodStart: -1 });
};
