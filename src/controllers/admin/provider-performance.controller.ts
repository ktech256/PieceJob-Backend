import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Provider, { ProviderTier } from '../../models/Provider';
import ProviderLifecycleLog, { ProviderLifecycleState } from '../../models/ProviderLifecycleLog';
import ProviderTierHistory from '../../models/ProviderTierHistory';
import ProviderPerformance from '../../models/ProviderPerformance';
import * as performanceService from '../../services/provider-performance.service';

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
