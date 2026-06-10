import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Ledger, { TransactionType } from '../../models/Ledger';
import Job, { JobStatus } from '../../models/Job';
import * as financialService from '../../services/financial.service';
import * as jobService from '../../services/job.service';

export const listPayments = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    const payments = await Ledger.find({
        ...query,
        type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] }
    }).populate('fromUserId', 'firstName lastName email')
      .populate('toUserId', 'firstName lastName email')
      .populate('jobId')
      .sort({ createdAt: -1 });

    // Map to Dashboard expected format
    const formattedPayments = payments.map(p => ({
        _id: p._id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        provider: p.type === TransactionType.SERVICE_FEE ? 'DIRECT' : 'PLATFORM',
        createdAt: p.createdAt,
        customer: {
            name: (p.fromUserId as any)?.firstName ? `${(p.fromUserId as any).firstName} ${(p.fromUserId as any).lastName}` : 'System',
            email: (p.fromUserId as any)?.email
        },
        job: p.jobId
    }));

    res.status(200).json({ success: true, payments: formattedPayments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payments', error });
  }
};

export const refundPayment = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const ledger = await Ledger.findById(id);
        if (!ledger) return res.status(404).json({ success: false, message: 'Transaction not found' });

        if (ledger.status === 'REFUNDED') {
            return res.status(400).json({ success: false, message: 'Already refunded' });
        }

        // Logic to initiate refund via gateway would go here

        ledger.status = 'REFUNDED';
        await ledger.save();

        // Create negative ledger entry
        await new Ledger({
            transactionId: `REFUND-${ledger.transactionId}`,
            jobId: ledger.jobId,
            fromUserId: ledger.toUserId,
            toUserId: ledger.fromUserId,
            amount: ledger.amount,
            currency: ledger.currency,
            countryCode: ledger.countryCode,
            type: TransactionType.REFUND,
            status: 'COMPLETED'
        }).save();

        res.status(200).json({ success: true, message: 'Refund processed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Refund failed', error });
    }
};

export const markJobPaid = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const job = await Job.findById(jobId);

        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (job.paymentStatus !== 'PAID') {
            await financialService.handleBookingFee(
                job.id,
                job.customerId.toString(),
                job.bookingFee,
                'USD', // Should be dynamic
                job.countryCode
            );

            job.paymentStatus = 'PAID';
            job.status = JobStatus.BROADCASTED;
            await job.save();

            jobService.broadcastJob(job.id);
        }

        res.status(200).json({ success: true, message: 'Job marked as paid and broadcasted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to mark job as paid', error });
    }
};
