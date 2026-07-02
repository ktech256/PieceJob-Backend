import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Provider, { VerificationStatus } from '../models/Provider';
import PanicAlert from '../models/PanicAlert';
import Job from '../models/Job';
import AuditLog from '../models/AuditLog';
import mongoose from 'mongoose';

import * as testUserService from '../services/test-user.service';
import * as auditService from '../services/audit.service';

export const cleanupTestUsers = async (req: AuthRequest, res: Response) => {
    try {
        const result = await testUserService.deleteTestUsers();
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Cleanup failed', error });
    }
};

export const getPendingVerifications = async (req: AuthRequest, res: Response) => {
  try {
    const providers = await Provider.find({
      verificationStatus: VerificationStatus.PENDING,
      countryCode: req.user?.countryCode
    }).populate('userId', 'firstName lastName email');

    res.status(200).json({ success: true, data: providers });
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

    if (status === VerificationStatus.APPROVED) {
        // Promote services
        const Service = mongoose.model('Service');
        const pendingServices = await Service.find({ code: { $in: provider.pendingServices } });

        const levelOrder = ['STANDARD', 'PROFESSIONAL', 'TRADE', 'HIGH_VETTING'];
        const provLevelIdx = levelOrder.indexOf(provider.verificationLevel);

        const newlyApproved: string[] = [];
        const remainingPending: string[] = [];

        for (const s of pendingServices) {
            const servLevelIdx = levelOrder.indexOf(s.verificationLevel);
            if (provLevelIdx >= servLevelIdx) {
                newlyApproved.push(s.code);
            } else {
                remainingPending.push(s.code);
            }
        }

        if (newlyApproved.length > 0) {
            provider.servicesOffered = [...new Set([...provider.servicesOffered, ...newlyApproved])];
            provider.pendingServices = remainingPending;
        }
    }

    await provider.save();

    // SECTION 13: System Ledger Record (Audit Log)
    await auditService.logAdminAction({
        countryCode: provider.countryCode,
        adminId: req.user?.userId as string,
        adminRole: req.user?.role as string,
        action: 'PROVIDER_VERIFICATION',
        entityType: 'Providers',
        entityId: providerId,
        beforeState: { status: previousStatus },
        afterState: { status, reason },
        ipAddress: req.ip,
        systemSource: 'ADMIN_DASHBOARD'
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
    const query: any = {
        countryCode: req.user?.countryCode,
        isTestTransaction: { $ne: true } // EXCLUDE TEST DATA
    };

    const revenueAgg = await Ledger.aggregate([
        { $match: { ...query, status: 'COMPLETED' } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const escrowAgg = await Wallet.aggregate([
        { $match: { countryCode: req.user?.countryCode } },
        // To strictly exclude test escrow, we'd need to join with User.isTestUser
        // For simplicity, we ensure test user wallets are flagged or just filtered by countryCode if test users use a fake code.
        // But the requirement says flag them.
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
        { $match: { 'user.isTestUser': { $ne: true } } },
        { $group: { _id: null, total: { $sum: "$balanceEscrow" } } }
    ]);

    const pendingPayoutsAgg = await Ledger.aggregate([
        { $match: { ...query, status: 'PENDING', type: 'PAYOUT' } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.status(200).json({
        success: true,
        data: {
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
        res.status(200).json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch ledger', error });
    }
};
