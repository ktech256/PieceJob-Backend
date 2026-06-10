import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Payout from '../../models/Payout';
import Ledger, { TransactionType } from '../../models/Ledger';
import mongoose from 'mongoose';

export const listPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    const payouts = await Payout.find(query)
      .populate({
        path: 'providerId',
        populate: { path: 'userId', select: 'firstName lastName email phoneNumber' }
      })
      .sort({ weekStartDate: -1 });

    // Map to the format expected by Dashboard
    const formattedPayouts = payouts.map(p => ({
        ...p.toObject(),
        provider: {
            _id: (p.providerId as any)._id,
            name: `${(p.providerId as any).userId?.firstName} ${(p.providerId as any).userId?.lastName}`,
            email: (p.providerId as any).userId?.email,
            phone: (p.providerId as any).userId?.phoneNumber
        }
    }));

    res.status(200).json({ success: true, payouts: formattedPayouts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payouts', error });
  }
};

export const markPayoutPaid = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const payout = await Payout.findById(id);
    if (!payout) return res.status(404).json({ success: false, message: 'Payout not found' });

    if (payout.status === 'PAID') {
        return res.status(400).json({ success: false, message: 'Payout already paid' });
    }

    payout.status = 'PAID';
    payout.processedAt = new Date();
    payout.auditTrail.push({
        action: 'MARK_PAID',
        performedBy: req.user?.userId as any,
        timestamp: new Date(),
        note: 'Manually marked as paid via admin dashboard'
    });

    await payout.save();

    // Here we would also create a Ledger entry of type 'PAYOUT_SETTLEMENT'
    await new Ledger({
        transactionId: `PAYOUT-${payout._id}`,
        toUserId: (payout.providerId as any).userId,
        amount: payout.totalAmount,
        currency: payout.currency,
        countryCode: payout.countryCode,
        type: TransactionType.PAYOUT,
        status: 'COMPLETED'
    }).save();

    res.status(200).json({ success: true, message: 'Payout marked as paid' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to process payout', error });
  }
};
