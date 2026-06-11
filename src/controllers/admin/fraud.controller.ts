import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import FraudAlert, { FraudRiskType, FraudStatus } from '../../models/FraudAlert';
import Job from '../../models/Job';
import Provider from '../../models/Provider';
import * as financialService from '../../services/financial.service';

export const getFraudAlerts = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode, status, riskType } = req.query;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (status) query.status = status;
        if (riskType) query.riskType = riskType;

        const alerts = await FraudAlert.find(query)
            .populate('userId', 'firstName lastName')
            .populate('providerId', 'userId')
            .populate('jobId')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, alerts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch alerts', error });
    }
};

export const resolveAlert = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status, resolution } = req.body;

        const alert = await FraudAlert.findById(id);
        if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });

        alert.status = status;
        alert.resolvedBy = req.user?.userId as any;
        alert.resolvedAt = new Date();
        await alert.save();

        // If it was a fake completion and we approved it (released escrow)
        if (alert.riskType === FraudRiskType.FAKE_COMPLETION && status === FraudStatus.REJECTED && alert.jobId) {
            // REJECTED here means "False Positive", so we release escrow
            await Job.findByIdAndUpdate(alert.jobId, { escrowStatus: 'RELEASED' });
        }

        res.status(200).json({ success: true, alert });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Resolution failed', error });
    }
};

export const getFakeCompletionQueue = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = { riskType: FraudRiskType.FAKE_COMPLETION, status: FraudStatus.PENDING };
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const queue = await FraudAlert.find(query)
            .populate('jobId')
            .populate('userId', 'firstName lastName')
            .populate({
                path: 'providerId',
                populate: { path: 'userId', select: 'firstName lastName' }
            });

        res.status(200).json({ success: true, queue });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Queue failed', error });
    }
};

export const getFraudAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const stats = await FraudAlert.aggregate([
            { $match: query },
            { $group: { _id: "$riskType", count: { $sum: 1 } } }
        ]);

        const totalAlerts = await FraudAlert.countDocuments(query);
        const criticalAlerts = await FraudAlert.countDocuments({ ...query, severity: 'CRITICAL' });
        const pendingReviews = await FraudAlert.countDocuments({ ...query, status: 'PENDING' });

        res.status(200).json({
            success: true,
            analytics: {
                totalAlerts,
                criticalAlerts,
                pendingReviews,
                distribution: stats
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Analytics failed', error });
    }
};

export const getFraudSenseFeed = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const feed = await FraudAlert.find(query)
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('userId', 'firstName lastName')
            .populate({
                path: 'providerId',
                populate: { path: 'userId', select: 'firstName lastName' }
            });

        res.status(200).json({ success: true, feed });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Feed failed', error });
    }
};
