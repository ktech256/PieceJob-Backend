import Provider, { ProviderTier } from '../models/Provider';
import ProviderPerformance from '../models/ProviderPerformance';
import ProviderTierHistory from '../models/ProviderTierHistory';
import PerformanceAdjustment, { PerformanceScoreType } from '../models/PerformanceAdjustment';
import ProviderBadge from '../models/ProviderBadge';
import Job, { JobStatus } from '../models/Job';
import { emitToUser } from '../socket/socket.service';
import { notifyUser } from './notification.service';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

export const recordAdjustment = async (data: {
    providerId: string;
    userId: string;
    scoreType: PerformanceScoreType;
    oldScore: number;
    newScore: number;
    adjustmentPoints: number;
    reason: string;
    jobId?: string;
    metadata?: any;
}) => {
    const adjustment = new PerformanceAdjustment({
        providerId: new mongoose.Types.ObjectId(data.providerId),
        userId: new mongoose.Types.ObjectId(data.userId),
        scoreType: data.scoreType,
        oldScore: data.oldScore,
        newScore: data.newScore,
        adjustmentPoints: data.adjustmentPoints,
        reason: data.reason,
        jobId: data.jobId ? new mongoose.Types.ObjectId(data.jobId) : undefined,
        metadata: data.metadata
    });
    await adjustment.save();
    return adjustment;
};

export const recalculateProviderMetrics = async (providerId: string) => {
    const provider = await Provider.findById(providerId);
    if (!provider) return null;

    const perf = provider.performance;

    const oldAcceptance = provider.performance.acceptanceRate;
    const oldCompletion = provider.performance.completionRate;

    provider.performance.acceptanceRate = perf.broadcastOpportunities > 0
        ? (perf.acceptedJobs / perf.broadcastOpportunities) * 100
        : 0;

    provider.performance.completionRate = perf.acceptedJobs > 0
        ? (perf.completedJobs / perf.acceptedJobs) * 100
        : 0;

    provider.performance.arrivalRate = perf.acceptedJobs > 0
        ? (perf.arrivedOnTimeJobs / perf.acceptedJobs) * 100
        : 0;

    provider.performance.complaintRate = perf.completedJobs > 0
        ? (perf.complaintsCount / perf.completedJobs) * 100
        : 0;

    // Log changes if significant
    if (Math.abs(oldAcceptance - provider.performance.acceptanceRate) > 1) {
        await recordAdjustment({
            providerId: provider._id.toString(),
            userId: provider.userId.toString(),
            scoreType: PerformanceScoreType.ACCEPTANCE,
            oldScore: oldAcceptance,
            newScore: provider.performance.acceptanceRate,
            adjustmentPoints: provider.performance.acceptanceRate - oldAcceptance,
            reason: 'Metric recalculation based on recent activity'
        });
    }

    await provider.save();
    await checkAndAwardBadges(provider._id.toString());
    return provider;
};

export const recordPenalty = async (userId: string, reason: string, jobId?: string) => {
    const provider = await Provider.findOne({ userId });
    if (!provider) return;

    const oldReliability = provider.performance.reliabilityScore;
    const oldOnTime = provider.performance.onTimeResponseScore;
    let points = 0;
    let type = PerformanceScoreType.RELIABILITY;

    // PAGE 8 & 12: Reliability Enforcement
    if (reason === 'INACTIVITY') {
        points = -5;
        provider.performance.reliabilityScore = Math.max(0, (provider.performance.reliabilityScore || 100) + points);
        provider.performance.onTimeResponseScore = Math.max(0, (provider.performance.onTimeResponseScore || 100) - 2);

        await recordAdjustment({
            providerId: provider._id.toString(),
            userId,
            scoreType: PerformanceScoreType.RELIABILITY,
            oldScore: oldReliability,
            newScore: provider.performance.reliabilityScore,
            adjustmentPoints: points,
            reason: 'Failed to begin travelling within 8 minutes.',
            jobId
        });
    } else if (reason === 'CANCELLATION') {
        points = -10;
        provider.performance.cancellationScore = (provider.performance.cancellationScore || 0) + 1;
        provider.performance.reliabilityScore = Math.max(0, (provider.performance.reliabilityScore || 100) + points);

        await recordAdjustment({
            providerId: provider._id.toString(),
            userId,
            scoreType: PerformanceScoreType.RELIABILITY,
            oldScore: oldReliability,
            newScore: provider.performance.reliabilityScore,
            adjustmentPoints: points,
            reason: jobId ? `Cancelled Job ${jobId.slice(-6)} during negotiation.` : 'Repeated cancellations.',
            jobId
        });
    }

    await provider.save();
    logger.info(`PERFORMANCE | PENALTY_RECORDED | User: ${userId} | Reason: ${reason} | New Reliability: ${provider.performance.reliabilityScore}`);
};

export const evaluateTier = async (providerId: string) => {
    const provider = await Provider.findById(providerId);
    if (!provider) return;

    const oldTier = provider.tier;
    const rating = provider.ratingAvg;
    const jobs = provider.jobsCompleted;

    let newTier = ProviderTier.BRONZE;

    if (rating >= 4.9 && jobs >= 300) {
        newTier = ProviderTier.ELITE;
    } else if (rating >= 4.8 && jobs >= 150) {
        newTier = ProviderTier.PLATINUM;
    } else if (rating >= 4.5 && jobs >= 50) {
        newTier = ProviderTier.GOLD;
    } else if (rating >= 4.2 && jobs >= 20) {
        newTier = ProviderTier.SILVER;
    } else if (rating >= 3.5) {
        newTier = ProviderTier.BRONZE;
    }

    if (newTier !== oldTier) {
        const tierPriority: Record<string, number> = { 'ELITE': 5, 'PLATINUM': 4, 'GOLD': 3, 'SILVER': 2, 'BRONZE': 1 };
        const isUpgrade = tierPriority[newTier] > tierPriority[oldTier];

        provider.tier = newTier;
        provider.isFeatured = (newTier === ProviderTier.ELITE);
        await provider.save();

        await ProviderTierHistory.create({
            providerId: provider._id,
            oldTier,
            newTier,
            reason: isUpgrade ? 'Performance Upgrade' : 'Performance Downgrade',
            countryCode: (provider as any).countryCode || 'ZA'
        });

        emitToUser(provider.userId.toString(), 'TIER_CHANGED', {
            oldTier,
            newTier,
            message: `Congratulations! Your tier has been updated to ${newTier}.`
        });

        await notifyUser(
            provider.userId.toString(),
            'Fleet Tier Updated',
            `Congratulations! You have been promoted to ${newTier} tier.`,
            { type: 'TIER_UPGRADE', newTier }
        );
    }
};

export const checkAndAwardBadges = async (providerId: string) => {
    const provider = await Provider.findById(providerId);
    if (!provider) return;

    const badgesToAward: any[] = [];
    const jobs = provider.jobsCompleted;
    const rating = provider.ratingAvg;
    const reliability = provider.performance.reliabilityScore;

    // Milestones
    if (jobs >= 100) badgesToAward.push({ code: 'JOBS_100', name: '100 Jobs Completed', desc: 'Completed 100 jobs on the platform.', icon: 'milestone_100' });
    if (jobs >= 500) badgesToAward.push({ code: 'JOBS_500', name: '500 Jobs Completed', desc: 'Completed 500 jobs on the platform.', icon: 'milestone_500' });

    // Performance based
    if (rating >= 4.8 && jobs >= 50) badgesToAward.push({ code: 'FIVE_STAR', name: 'Five-Star Provider', desc: 'Maintained a near-perfect rating over 50 jobs.', icon: 'star_champion' });
    if (reliability >= 95 && jobs >= 20) badgesToAward.push({ code: 'RELIABLE_PRO', name: 'Reliable Provider', desc: 'Exemplary reliability and on-time performance.', icon: 'reliability_badge' });
    if (provider.performance.arrivalRate >= 98 && jobs >= 20) badgesToAward.push({ code: 'ON_TIME_CHAMP', name: 'On-Time Champion', desc: 'Always arrives on time.', icon: 'on_time_badge' });

    for (const b of badgesToAward) {
        const existing = await ProviderBadge.findOne({ providerId: provider._id, badgeCode: b.code });
        if (!existing) {
            await ProviderBadge.create({
                providerId: provider._id,
                badgeCode: b.code,
                name: b.name,
                description: b.desc,
                iconUrl: b.icon
            });

            await notifyUser(provider.userId.toString(), 'New Badge Earned!', `Congratulations! You have earned the ${b.name} badge.`, { type: 'BADGE_EARNED', badgeCode: b.code });
            emitToUser(provider.userId.toString(), 'BADGE_EARNED', { badgeCode: b.code, name: b.name });
        }
    }
};

export const recoverScores = async () => {
    // Score recovery for consistently improving providers
    // Logic: If no penalties in the last 7 days and current score < 100, boost slightly.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const providers = await Provider.find({
        'performance.reliabilityScore': { $lt: 100 }
    });

    for (const provider of providers) {
        const recentAdjustments = await PerformanceAdjustment.countDocuments({
            providerId: provider._id,
            adjustmentPoints: { $lt: 0 },
            createdAt: { $gte: sevenDaysAgo }
        });

        if (recentAdjustments === 0) {
            const oldReliability = provider.performance.reliabilityScore;
            provider.performance.reliabilityScore = Math.min(100, provider.performance.reliabilityScore + 2);

            if (oldReliability !== provider.performance.reliabilityScore) {
                await recordAdjustment({
                    providerId: provider._id.toString(),
                    userId: provider.userId.toString(),
                    scoreType: PerformanceScoreType.RELIABILITY,
                    oldScore: oldReliability,
                    newScore: provider.performance.reliabilityScore,
                    adjustmentPoints: 2,
                    reason: 'Reliability restored due to consistent positive performance.'
                });
                await provider.save();

                await notifyUser(provider.userId.toString(), 'Reliability Restored', 'Your reliability score has improved due to your consistent professional performance.');
            }
        }
    }
};

export const getProviderAnalytics = async (providerId: string, period: '7d' | '30d' | '90d' | 'all') => {
    const provider = await Provider.findById(providerId);
    if (!provider) return null;

    let startDate = new Date(0);
    if (period === '7d') startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    else if (period === '30d') startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    else if (period === '90d') startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [adjustments, jobs, earnings] = await Promise.all([
        PerformanceAdjustment.find({ providerId, createdAt: { $gte: startDate } }).sort({ createdAt: -1 }),
        Job.find({ providerId: provider.userId, createdAt: { $gte: startDate } }),
        mongoose.model('Ledger').aggregate([
            { $match: { toUserId: provider.userId, type: 'SERVICE_FEE', createdAt: { $gte: startDate }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ])
    ]);

    // Calculate trends
    // ... complex aggregation for trends ...

    return {
        currentScores: {
            reliability: provider.performance.reliabilityScore,
            acceptance: provider.performance.acceptanceRate,
            cancellation: provider.performance.cancellationScore,
            onTime: provider.performance.arrivalRate,
            rating: provider.ratingAvg
        },
        jobs: {
            accepted: provider.performance.acceptedJobs,
            completed: provider.performance.completedJobs,
            cancelled: provider.performance.cancellationScore
        },
        earnings: earnings[0]?.total || 0,
        adjustments,
        // rankings, etc.
    };
};

export const takePerformanceSnapshot = async (countryCode: string) => {
    const providers = await Provider.find(); // Ideally filtered by countryCode if available on Provider
    const now = new Date();

    for (const provider of providers) {
        await recalculateProviderMetrics(provider._id.toString());
        await evaluateTier(provider._id.toString());

        await ProviderPerformance.create({
            providerId: provider._id,
            acceptanceRate: provider.performance.acceptanceRate,
            completionRate: provider.performance.completionRate,
            arrivalRate: provider.performance.arrivalRate,
            complaintRate: provider.performance.complaintRate,
            ratingAvg: provider.ratingAvg,
            reliabilityScore: provider.performance.reliabilityScore,
            cancellationScore: provider.performance.cancellationScore,
            acceptanceScore: provider.performance.acceptanceRate, // Map rate to score
            onTimeResponseScore: provider.performance.onTimeResponseScore,
            periodStart: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
            periodEnd: now,
            countryCode: (provider as any).countryCode || 'ZA'
        });
    }
};
