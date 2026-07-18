import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Provider, { ProviderTier } from '../../models/Provider';
import ProviderLifecycleLog, { ProviderLifecycleState } from '../../models/ProviderLifecycleLog';
import ProviderTierHistory from '../../models/ProviderTierHistory';
import ProviderPerformance from '../../models/ProviderPerformance';
import User from '../../models/User';
import * as notificationQueue from '../../services/notification.queue';
import * as performanceService from '../../services/provider-performance.service';

import ProviderAdjustment from '../../models/PerformanceAdjustment';
import ProviderAppeal, { AppealStatus } from '../../models/ProviderAppeal';
import ProviderBadge from '../../models/ProviderBadge';
import mongoose from 'mongoose';

export const listAppeals = async (req: AuthRequest, res: Response) => {
    try {
        const { status } = req.query;
        const query: any = {};
        if (status) query.status = status;

        const appeals = await ProviderAppeal.find(query)
            .sort({ createdAt: -1 })
            .populate('providerId', 'firstName lastName profilePhoto')
            .populate('userId', 'firstName lastName email')
            .populate('adjustmentId');

        res.status(200).json({ success: true, data: appeals });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list appeals', error });
    }
};

export const reviewAppeal = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { appealId } = req.params;
        const { status, adminNotes, adjustmentAction } = req.body; // status: APPROVED, REJECTED; adjustmentAction: REVERSE, KEEP

        const appeal = await ProviderAppeal.findById(appealId).session(session);
        if (!appeal) return res.status(404).json({ success: false, message: 'Appeal not found' });

        appeal.status = status;
        appeal.adminNotes = adminNotes;
        appeal.adminId = new mongoose.Types.ObjectId(req.user?.userId);
        appeal.decisionDate = new Date();

        if (status === AppealStatus.APPROVED && adjustmentAction === 'REVERSE' && appeal.adjustmentId) {
            const adj: any = await ProviderAdjustment.findById(appeal.adjustmentId).session(session);
            if (adj) {
                const provider = await Provider.findById(adj.providerId).session(session);
                if (provider) {
                    const oldScore = provider.performance.reliabilityScore;
                    const reversePoints = Math.abs(adj.adjustmentPoints);
                    provider.performance.reliabilityScore = Math.min(100, provider.performance.reliabilityScore + reversePoints);

                    await performanceService.recordAdjustment({
                        providerId: provider._id.toString(),
                        userId: provider.userId.toString(),
                        scoreType: adj.scoreType,
                        oldScore: oldScore,
                        newScore: provider.performance.reliabilityScore,
                        adjustmentPoints: reversePoints,
                        reason: `Appeal Approved: ${adminNotes}`,
                        metadata: { reversedAdjustmentId: adj._id }
                    });

                    await provider.save({ session });
                }
            }
        }

        await appeal.save({ session });

        await session.commitTransaction();

        // Notify provider
        const { notifyUser } = require('../../services/notification.service');
        await notifyUser(
            appeal.userId.toString(),
            status === AppealStatus.APPROVED ? 'Appeal Approved' : 'Appeal Rejected',
            `Regarding your appeal for penalty: ${adminNotes}`
        );

        res.status(200).json({ success: true, message: 'Appeal reviewed successfully' });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

export const getGlobalPerformanceOverview = async (req: AuthRequest, res: Response) => {
    try {
        const stats = await Provider.aggregate([
            {
                $group: {
                    _id: null,
                    avgReliability: { $avg: "$performance.reliabilityScore" },
                    avgAcceptance: { $avg: "$performance.acceptanceRate" },
                    avgCompletion: { $avg: "$performance.completionRate" },
                    totalJobs: { $sum: "$jobsCompleted" },
                    avgRating: { $avg: "$ratingAvg" }
                }
            }
        ]);

        const trends = await ProviderPerformance.aggregate([
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    reliability: { $avg: "$reliabilityScore" },
                    acceptance: { $avg: "$acceptanceScore" },
                    rating: { $avg: "$ratingAvg" }
                }
            },
            { $sort: { "_id": 1 } },
            { $limit: 30 }
        ]);

        res.status(200).json({ success: true, stats: stats[0], trends });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch global stats', error });
    }
};

export const listProviderRankings = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode, city, province } = req.query;
        const query: any = {};
        if (countryCode) query.countryCode = countryCode;

        // This would ideally join with User to filter by city/province
        const providers = await Provider.find(query)
            .sort({ 'performance.reliabilityScore': -1, ratingAvg: -1, jobsCompleted: -1 })
            .limit(100)
            .populate('userId', 'firstName lastName profilePhoto city province');

        const formatted = providers.map((p, index) => ({
            rank: index + 1,
            id: p._id,
            name: `${(p.userId as any).firstName} ${(p.userId as any).lastName}`,
            photo: (p.userId as any).profilePhoto,
            location: `${(p.userId as any).city}, ${(p.userId as any).province}`,
            reliability: p.performance.reliabilityScore,
            rating: p.ratingAvg,
            jobs: p.jobsCompleted,
            tier: p.tier
        }));

        res.status(200).json({ success: true, data: formatted });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch rankings', error });
    }
};

export const listAdjustments = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId, scoreType } = req.query;
        const query: any = {};
        if (providerId) query.providerId = providerId;
        if (scoreType) query.scoreType = scoreType;

        const adjustments = await ProviderAdjustment.find(query)
            .sort({ createdAt: -1 })
            .limit(100)
            .populate('providerId', 'firstName lastName')
            .populate('jobId', 'serviceName');

        res.status(200).json({ success: true, data: adjustments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list adjustments', error });
    }
};

export const getProviderPerformanceDetail = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId } = req.params;
        const provider = await Provider.findById(providerId).populate('userId', 'firstName lastName email phoneNumber');

        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const tierHistory = await ProviderTierHistory.find({ providerId }).sort({ createdAt: -1 });
        const lifecycleHistory = await ProviderLifecycleLog.find({ providerId }).sort({ createdAt: -1 });
        const performanceHistory = await ProviderPerformance.find({ providerId }).sort({ createdAt: -1 }).limit(30);

        res.status(200).json({
            success: true,
            provider,
            tierHistory,
            lifecycleHistory,
            performanceHistory
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch details', error });
    }
};

export const updateProviderLifecycle = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId } = req.params;
        const { status, reason } = req.body;

        const provider = await Provider.findById(providerId);
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const previousStatus = provider.lifecycleState;
        provider.lifecycleState = status;

        if (status === ProviderLifecycleState.SUSPENDED) {
            provider.suspendedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
        } else if (status === ProviderLifecycleState.REINSTATED || status === ProviderLifecycleState.ACTIVE) {
            provider.suspendedUntil = undefined;
        }

        await provider.save();

        await ProviderLifecycleLog.create({
            providerId,
            status,
            previousStatus,
            changedBy: req.user?.userId as any,
            reason,
            countryCode: provider.countryCode,
            timestamp: new Date()
        });

        // Dispatch Suspension/Reinstated Email
        const user = await User.findById(provider.userId);
        if (user?.email) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email: user.email,
                templateCode: status === ProviderLifecycleState.SUSPENDED ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED',
                templateData: {
                    firstName: user.firstName,
                    reason: reason || 'N/A'
                },
                countryCode: user.countryCode
            });
        }

        res.status(200).json({ success: true, provider });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed', error });
    }
};

export const listTopProviders = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const providers = await Provider.find(query)
            .sort({ 'performance.completionRate': -1, ratingAvg: -1 })
            .limit(50)
            .populate('userId', 'firstName lastName');

        res.status(200).json({ success: true, providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list providers', error });
    }
};

export const triggerMetricRecalculation = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        await performanceService.takePerformanceSnapshot(countryCode as string);
        res.status(200).json({ success: true, message: 'Recalculation triggered' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPerformanceAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const tierDistribution = await Provider.aggregate([
            { $match: query },
            { $group: { _id: "$tier", count: { $sum: 1 } } }
        ]);

        const onlineStatus = await Provider.aggregate([
            { $match: query },
            { $group: { _id: "$isOnline", count: { $sum: 1 } } }
        ]);

        res.status(200).json({
            success: true,
            tierDistribution,
            onlineStatus
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Analytics failed', error });
    }
};
