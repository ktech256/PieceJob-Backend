import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Payout, { PayoutStatus } from '../../models/Payout';
import * as payoutService from '../../services/payout.service';

export const listPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const { status } = req.query;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
    if (status) query.status = status;

    const payouts = await Payout.find(query)
      .populate({
        path: 'providerId',
        populate: { path: 'userId', select: 'firstName lastName email phoneNumber' }
      });

    // Sort by Tier Priority then Date
    const tierPriority: Record<string, number> = { 'ELITE': 1, 'PLATINUM': 2, 'GOLD': 3, 'SILVER': 4, 'BRONZE': 5 };
    payouts.sort((a: any, b: any) => {
        const priorityA = tierPriority[a.providerId?.tier] || 99;
        const priorityB = tierPriority[b.providerId?.tier] || 99;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const formattedPayouts = payouts.map(p => ({
        ...p.toObject(),
        provider: {
            _id: (p.providerId as any)._id,
            name: `${(p.providerId as any).userId?.firstName} ${(p.providerId as any).userId?.lastName}`,
            email: (p.providerId as any).userId?.email,
            phone: (p.providerId as any).userId?.phoneNumber,
            tier: (p.providerId as any).tier
        }
    }));

    res.status(200).json({ success: true, payouts: formattedPayouts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payouts', error });
  }
};

export const approveBatch = async (req: AuthRequest, res: Response) => {
    try {
        const { ids } = req.body;
        const result = await payoutService.approvePayoutBatch(ids, req.user?.userId as string);
        res.status(200).json({ success: true, message: `${result.length} payouts approved` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const processBatch = async (req: AuthRequest, res: Response) => {
    try {
        const { ids } = req.body;
        const result = await payoutService.processPayoutBatch(ids, req.user?.userId as string);
        res.status(200).json({ success: true, batchId: result.batchId, message: `${result.processedCount} payouts moved to processing` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const markPayoutPaid = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { bankReference } = req.body;
    await payoutService.markPaid(id, bankReference, req.user?.userId as string);
    res.status(200).json({ success: true, message: 'Payout marked as paid' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const reversePayout = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        await payoutService.reversePayout(id, reason, req.user?.userId as string);
        res.status(200).json({ success: true, message: 'Payout reversed' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const exportPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const { status, format } = req.query;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
    if (status) query.status = status;

    const payouts = await Payout.find(query)
      .populate({
        path: 'providerId',
        populate: { path: 'userId', select: 'firstName lastName email phoneNumber' }
      });

    if (format === 'csv') {
      let csv = 'PayoutID,Provider,Amount,Currency,Status,Date\n';
      payouts.forEach((p: any) => {
        csv += `${p._id},"${p.providerId?.userId?.firstName} ${p.providerId?.userId?.lastName}",${p.totalAmount},${p.currency},${p.status},${p.createdAt}\n`;
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=payouts.csv');
      return res.status(200).send(csv);
    }

    res.status(400).json({ success: false, message: 'Unsupported format' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed', error });
  }
};
