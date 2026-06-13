import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Provider, { VerificationStatus } from '../models/Provider';
import { emitAdminUpdate } from '../socket/socket.service';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
import mongoose from 'mongoose';
import * as presenceService from '../services/provider-presence.service';

export const getProviderProfile = async (req: AuthRequest, res: Response) => {
  try {
    const provider = await Provider.findOne({ userId: req.user?.userId }).populate('userId', '-passwordHash');
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }
    res.status(200).json({
      success: true,
      provider: {
        ...provider.toObject(),
        isShadowBanned: provider.isShadowBanned
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch provider profile', error });
  }
};

export const updateStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { isOnline } = req.body;
    const provider = await Provider.findOneAndUpdate(
      { userId: req.user?.userId },
      { isOnline, lastHeartbeat: new Date() },
      { new: true }
    );

    emitAdminUpdate('provider_status_changed', {
        userId: req.user?.userId,
        isOnline: provider?.isOnline,
        timestamp: new Date()
    });

    res.status(200).json({ success: true, isOnline: provider?.isOnline });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Status update failed', error });
  }
};

export const handleHeartbeat = async (req: AuthRequest, res: Response) => {
    try {
        const { coordinates, hardwareId, isMockLocation } = req.body;
        await presenceService.handleHeartbeat(req.user?.userId as string, coordinates, hardwareId, isMockLocation);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Heartbeat failed', error });
    }
};

export const uploadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { type, url } = req.body; // In real app, this would be a file upload
    const provider = await Provider.findOneAndUpdate(
      { userId: req.user?.userId },
      { $push: { documents: { type, url, status: VerificationStatus.PENDING } } },
      { new: true }
    );
    res.status(200).json({ success: true, message: 'Document uploaded', provider });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Document upload failed', error });
  }
};

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const now = new Date();
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        const provider = await Provider.findOne({ userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const earningsToday = await Ledger.aggregate([
            { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: startOfToday }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const earningsWeekly = await Ledger.aggregate([
            { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: weekAgo }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const earningsMonthly = await Ledger.aggregate([
            { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: monthAgo }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const jobs = await Job.aggregate([
            { $match: { providerId: new mongoose.Types.ObjectId(userId) } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        const jobsByStatus: any = {};
        jobs.forEach(j => { jobsByStatus[j._id] = j.count; });

        res.status(200).json({
            success: true,
            data: {
                earningsToday: earningsToday[0]?.total || 0,
                earningsWeekly: earningsWeekly[0]?.total || 0,
                earningsMonthly: earningsMonthly[0]?.total || 0,
                jobsCompleted: jobsByStatus[JobStatus.COMPLETED] || 0,
                jobsActive: (jobsByStatus[JobStatus.ACCEPTED] || 0) + (jobsByStatus[JobStatus.ARRIVED] || 0) + (jobsByStatus[JobStatus.STARTED] || 0),
                acceptanceRate: provider.performance.acceptanceRate,
                completionRate: provider.performance.completionRate,
                arrivalRate: provider.performance.arrivalRate,
                tier: provider.tier,
                tierProgress: 0.75, // Placeholder for logic
                rating: provider.ratingAvg,
                verificationStatus: provider.verificationStatus,
                isGhostMode: false
            }
        });
    } catch (error) {
        console.error('[STATS_ERROR]', error);
        res.status(500).json({ success: false, message: 'Stats failed', error });
    }
};
