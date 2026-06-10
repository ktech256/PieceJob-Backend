import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Provider, { VerificationStatus } from '../models/Provider';
import PanicAlert from '../models/PanicAlert';
import Job from '../models/Job';
import AuditLog from '../models/AuditLog';

export const getPendingVerifications = async (req: AuthRequest, res: Response) => {
  try {
    const providers = await Provider.find({
      verificationStatus: VerificationStatus.PENDING,
      countryCode: req.user?.countryCode
    }).populate('userId', 'firstName lastName email');

    res.status(200).json({ success: true, providers });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch verifications', error });
  }
};

export const verifyProvider = async (req: AuthRequest, res: Response) => {
  try {
    const { providerId } = req.params;
    const { status, reason } = req.body; // APPROVED or REJECTED

    const provider = await Provider.findById(providerId);
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    const previousStatus = provider.verificationStatus;
    provider.verificationStatus = status;
    await provider.save();

    // SECTION 13: System Ledger Record (Audit Log)
    await AuditLog.create({
      adminId: req.user?.userId,
      action: 'PROVIDER_VERIFICATION',
      targetId: providerId,
      targetCollection: 'Providers',
      previousValue: { status: previousStatus },
      newValue: { status, reason },
      ipAddress: req.ip
    });

    res.status(200).json({ success: true, message: `Provider ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Verification update failed', error });
  }
};

import Ledger from '../models/Ledger';
import Wallet from '../models/Wallet';

export const getFinancialOverview = async (req: AuthRequest, res: Response) => {
  try {
    const query: any = { countryCode: req.user?.countryCode };

    const revenueAgg = await Ledger.aggregate([
        { $match: { ...query, status: 'COMPLETED' } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const escrowAgg = await Wallet.aggregate([
        { $match: { countryCode: req.user?.countryCode } },
        { $group: { _id: null, total: { $sum: "$balanceEscrow" } } }
    ]);

    const pendingPayoutsAgg = await Ledger.aggregate([
        { $match: { ...query, status: 'PENDING', type: 'PAYOUT' } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.status(200).json({
        success: true,
        stats: {
            totalRevenue: revenueAgg[0]?.total || 0,
            pendingPayouts: pendingPayoutsAgg[0]?.total || 0,
            activeEscrow: escrowAgg[0]?.total || 0
        }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch overview', error });
  }
};

export const getDetailedLedger = async (req: AuthRequest, res: Response) => {
    try {
        const query: any = { countryCode: req.user?.countryCode };
        const logs = await Ledger.find(query)
            .sort({ createdAt: -1 })
            .limit(50);
        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch ledger', error });
    }
};
