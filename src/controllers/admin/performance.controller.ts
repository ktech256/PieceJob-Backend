import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Provider from '../../models/Provider';
import PerformanceAdjustment from '../../models/PerformanceAdjustment';
import ProviderAppeal, { AppealStatus } from '../../models/ProviderAppeal';
import ProviderBadge from '../../models/ProviderBadge';
import ProviderPerformance from '../../models/ProviderPerformance';
import Job from '../../models/Job';
import * as performanceService from '../../services/provider-performance.service';
import * as notificationService from '../../services/notification.service';
import * as auditService from '../../services/audit.service';
import mongoose from 'mongoose';

export const listAppeals = async (req: AuthRequest, res: Response) => {
    try {
        const { status } = req.query;
        const query: any = {};
        if (status) query.status = status;

        const appeals = await ProviderAppeal.find(query)
            .sort({ createdAt: -1 })
            .populate('providerId', 'firstName lastName profilePhoto')
            .populate('userId', 'firstName lastName')
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
            const adj: any = await PerformanceAdjustment.findById(appeal.adjustmentId).session(session);
            if (adj) {
                const provider = await Provider.findById(adj.providerId).session(session);
                if (provider) {
                    const oldScore = provider.performance.reliabilityScore;
                    // Reverse the penalty (if adjustmentPoints was negative)
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

        await auditService.logAdminAction({
            countryCode: 'GLOBAL', // or from provider
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'APPEAL_REVIEWED',
            entityType: 'ProviderAppeal',
            entityId: appealId,
            afterState: { status, adminNotes },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        }, session);

        await session.commitTransaction();

        // Notify provider
        await notificationService.notifyUser(
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
                    totalJobs: { $sum: "$jobsCompleted" }
                }
            }
        ]);

        res.status(200).json({ success: true, data: stats[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch global stats', error });
    }
};

export const listProviderRankings = async (req: AuthRequest, res: Response) => {
    try {
        const { scope, countryCode } = req.query; // scope: national, province, city
        const query: any = {};
        if (countryCode) query.countryCode = countryCode;

        const providers = await Provider.find(query)
            .sort({ 'performance.reliabilityScore': -1, ratingAvg: -1 })
            .limit(100)
            .populate('userId', 'firstName lastName profilePhoto city province');

        res.status(200).json({ success: true, data: providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch rankings', error });
    }
};
