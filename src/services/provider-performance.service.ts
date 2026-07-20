import Provider, { ProviderTier } from '../models/Provider';
import ProviderPerformance from '../models/ProviderPerformance';
import ProviderTierHistory from '../models/ProviderTierHistory';
import PerformanceAdjustment, { PerformanceScoreType } from '../models/PerformanceAdjustment';
import ProviderBadge from '../models/ProviderBadge';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
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
}, session?: mongoose.ClientSession) => {
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
    await adjustment.save({ session });
    return adjustment;
};

export const recalculateProviderMetrics = async (providerId: string, session?: mongoose.ClientSession, existingProvider?: any) => {
    const provider = existingProvider || await Provider.findById(providerId).session(session || null);
    if (!provider) return null;

    if (!provider.performance) {
        provider.performance = {
            acceptedJobs: 0,
            completedJobs: 0,
            broadcastOpportunities: 0,
            arrivedOnTimeJobs: 0,
            cancellationCount: 0,
            reliabilityScore: 100,
            cancellationScore: 100,
            acceptanceRate: 100,
            completionRate: 100,
            arrivalRate: 100,
            healthScore: 100
        } as any;
    }

    // FORENSIC RECOVERY: Recalculate raw counts from Job Collection (Source of Truth)
    // Exclude test jobs and immediate completions from operational averages (Issue 15)
    const jobsAgg = await Job.aggregate([
        { $match: { providerId: provider.userId, isTestJob: { $ne: true } } },
        { $group: {
            _id: null,
            totalAccepted: { $sum: 1 },
            totalCompleted: { $sum: { $cond: [{ $in: ["$status", [JobStatus.COMPLETED, JobStatus.RATED, JobStatus.CLOSED]] }, 1, 0] } },
            // Measurable Arrival (Issue 7 & 14): distance > 50m OR travel time > 1 min
            totalMeasurableArrivals: { $sum: { $cond: [
                { $and: [
                    { $gt: ["$arrivedAt", null] },
                    { $or: [
                        { $gt: ["$distanceTravelled", 50] },
                        { $gt: [{ $subtract: ["$arrivedAt", "$acceptedAt"] }, 60000] }
                    ]}
                ]}, 1, 0]
            }},
            totalOnTimeArrivals: { $sum: { $cond: [
                { $and: [
                    { $gt: ["$arrivedAt", null] },
                    { $lte: [{ $subtract: ["$arrivedAt", "$acceptedAt"] }, 1200000] }
                ]}, 1, 0]
            }}
        } }
    ]);

    const stats = jobsAgg[0] || { totalAccepted: 0, totalCompleted: 0, totalMeasurableArrivals: 0, totalOnTimeArrivals: 0 };
    const broadcastCount = provider.performance.broadcastOpportunities || 0;
    const cancelledCount = provider.performance.cancellationCount || 0;

    // 1. Sync Raw Counters
    provider.performance.completedJobs = Math.max(stats.totalCompleted, provider.jobsCompleted || 0);
    provider.performance.acceptedJobs = Math.max(stats.totalAccepted, provider.performance.completedJobs + cancelledCount);

    // 2. Initial Scores for New Providers (Recovery Logic for Issue 1, 2, 5)
    if (provider.performance.reliabilityScore === 0 && provider.performance.completedJobs >= 0 && cancelledCount === 0) {
        provider.performance.reliabilityScore = 100;
    }
    if (provider.performance.cancellationScore === 0 && cancelledCount === 0) {
        provider.performance.cancellationScore = 100;
    }

    const oldAcceptance = provider.performance.acceptanceRate;

    // 3. Rate Calculations with Divide-by-Zero Protection (Issue 14)
    // Map to -1 (N/A) if no valid denominator exists
    provider.performance.acceptanceRate = broadcastCount > 0
        ? Math.min(100, (provider.performance.acceptedJobs / broadcastCount) * 100)
        : -1;

    provider.performance.completionRate = provider.performance.acceptedJobs > 0
        ? Math.min(100, (provider.performance.completedJobs / provider.performance.acceptedJobs) * 100)
        : -1;

    provider.performance.arrivalRate = stats.totalMeasurableArrivals > 0
        ? Math.min(100, (stats.totalOnTimeArrivals / stats.totalMeasurableArrivals) * 100)
        : -1;

    provider.performance.complaintRate = provider.performance.completedJobs > 0
        ? (provider.performance.complaintsCount / provider.performance.completedJobs) * 100
        : 0;

    // 4. Persistence
    provider.markModified('performance');
    await provider.save({ session });

    await checkAndAwardBadges(provider._id.toString(), session, provider);
    await calculateHealthScore(provider._id.toString(), session, provider);
    return provider;
};

export const calculateHealthScore = async (providerId: string, session?: mongoose.ClientSession, existingProvider?: any) => {
    const provider = existingProvider || await Provider.findById(providerId).session(session || null);
    if (!provider) return 0;

    const ratingCount = provider.ratingCount || 0;
    const completedJobs = provider.jobsCompleted || 0;

    // ISSUE 1: Health Score becomes meaningful after data exists
    if (completedJobs === 0) {
        provider.performance.healthScore = -1; // -1 for Pending/Insufficient
        await provider.save({ session });
        return -1;
    }

    const isProbation = ratingCount < 5;

    let healthScore = 0;

    // Denominator handling for rates (Issue 14 redistribution)
    const accRate = provider.performance.acceptanceRate === -1 ? 100 : provider.performance.acceptanceRate;
    const arrRate = provider.performance.arrivalRate === -1 ? 100 : provider.performance.arrivalRate;

    if (isProbation) {
        // Exclude Rating (25%) and redistribute weight to remaining 75%
        // New Weights: Reliability (33.3%), Acceptance (26.7%), Cancellation (20%), Arrival (20%)
        const reliabilityComp = (provider.performance.reliabilityScore ?? 100) * 0.3333;
        const acceptanceComp = accRate * 0.2667;
        const cancellationComp = (provider.performance.cancellationScore ?? 100) * 0.20;
        const arrivalComp = arrRate * 0.20;
        healthScore = reliabilityComp + acceptanceComp + cancellationComp + arrivalComp;
    } else {
        const ratingComp = (provider.ratingAvg / 5) * 25;
        const reliabilityComp = (provider.performance.reliabilityScore ?? 100) * 0.25;
        const acceptanceComp = accRate * 0.20;
        const cancellationComp = (provider.performance.cancellationScore ?? 100) * 0.15;
        const arrivalComp = arrRate * 0.15;
        healthScore = ratingComp + reliabilityComp + acceptanceComp + cancellationComp + arrivalComp;
    }

    healthScore = Math.min(100, Math.max(0, healthScore));

    const oldHealth = (provider.performance as any).healthScore || 0;

    provider.performance.healthScore = healthScore;
    await provider.save({ session });

    if (oldHealth !== -1 && Math.abs(oldHealth - healthScore) >= 5) {
        const status = getHealthStatus(healthScore);
        setImmediate(async () => {
            await notifyUser(provider.userId.toString(), 'Health Score Update', `Your overall health score is now ${healthScore.toFixed(0)}% (${status}).`);
        });
    }

    return healthScore;
};

export const getFullProviderStats = async (userId: string) => {
    // 1. Force recalculation with DB synchronization
    const provider = await Provider.findOne({ userId });
    if (!provider) return null;

    // Ensure all counters are fresh from the Job collection
    await recalculateProviderMetrics(provider._id.toString());

    const refreshedProvider = await Provider.findById(provider._id).populate('userId', 'createdAt');
    if (!refreshedProvider) return null;

    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [earningsToday, earningsWeekly, earningsMonthly, earningsLifetime, jobsAgg] = await Promise.all([
        getProviderNetEarnings(userId, startOfToday),
        getProviderNetEarnings(userId, weekAgo),
        getProviderNetEarnings(userId, monthAgo),
        getProviderNetEarnings(userId, new Date(0)),
        Job.aggregate([
            { $match: { providerId: new mongoose.Types.ObjectId(userId) } },
            { $group: {
                _id: "$status",
                count: { $sum: 1 }
            } }
        ])
    ]);

    const jobsByStatus: any = {};
    jobsAgg.forEach((j: any) => { jobsByStatus[j._id] = j.count; });

    // Source of Truth counts (Operational Efficiency)
    const jobsCompleted = (jobsByStatus[JobStatus.COMPLETED] || 0) + (jobsByStatus[JobStatus.RATED] || 0) + (jobsByStatus[JobStatus.CLOSED] || 0);
    const jobsCancelledCount = refreshedProvider.performance.cancellationCount || 0;
    const activeCount = (jobsByStatus[JobStatus.ACCEPTED] || 0) + (jobsByStatus[JobStatus.ARRIVED] || 0) + (jobsByStatus[JobStatus.STARTED] || 0) + (jobsByStatus[JobStatus.EN_ROUTE] || 0) + (jobsByStatus[JobStatus.IN_PROGRESS] || 0);

    const jobsAccepted = Math.max(refreshedProvider.performance.acceptedJobs || 0, jobsCompleted + jobsCancelledCount + activeCount);

    // Earnings consistency (Issue 12)
    const finalEarningsLifetime = earningsLifetime;

    const healthScore = refreshedProvider.performance.healthScore; // Might be -1
    const healthStatus = healthScore === -1 ? "Insufficient Data" : getHealthStatus(healthScore);

    // Timeline and efficiency (Source of Truth)
    // Exclude extremely short durations (< 2 mins) from averages (Issue 9 & 15)
    const recentJobs = await Job.find({
        providerId: new mongoose.Types.ObjectId(userId),
        status: { $in: [JobStatus.COMPLETED, JobStatus.RATED, JobStatus.CLOSED] },
        isTestJob: { $ne: true }
    }).limit(20);

    let totalArrivalMin = 0;
    let arrivedCount = 0;
    let totalDurationMin = 0;
    let durationCount = 0;

    recentJobs.forEach(j => {
        if (j.acceptedAt && j.arrivedAt) {
            const arrDiff = (j.arrivedAt.getTime() - j.acceptedAt.getTime()) / (1000 * 60);
            if (arrDiff > 1) { // Issue 8: Exclude < 1 min arrivals
                totalArrivalMin += arrDiff;
                arrivedCount++;
            }
        }
        if (j.startedAt && j.completedAt) {
            const durDiff = (j.completedAt.getTime() - j.startedAt.getTime()) / (1000 * 60);
            if (durDiff > 2) { // Issue 9: Exclude < 2 mins duration
                totalDurationMin += durDiff;
                durationCount++;
            }
        }
    });

    const avgArrivalLabel = arrivedCount > 0 ? `${Math.round(totalArrivalMin / arrivedCount)} mins` : null;
    const avgDurationLabel = durationCount > 0 ? `${Math.round(totalDurationMin / durationCount)} mins` : null;

    const badges = await ProviderBadge.find({ providerId: refreshedProvider._id }).sort({ earnedAt: -1 }).limit(3);

    return {
        earningsToday,
        earningsWeekly,
        earningsMonthly,
        earningsLifetime: finalEarningsLifetime,
        jobsAccepted,
        jobsCompleted,
        jobsCancelled: refreshedProvider.performance.cancellationScore || 100,
        cancellationCount: jobsCancelledCount,
        jobsActive: activeCount,
        // Map -1 to null for DTO to handle "N/A" (Issue 1, 7, 14)
        acceptanceRate: refreshedProvider.performance.acceptanceRate === -1 ? null : refreshedProvider.performance.acceptanceRate,
        completionRate: refreshedProvider.performance.completionRate === -1 ? null : refreshedProvider.performance.completionRate,
        arrivalRate: refreshedProvider.performance.arrivalRate === -1 ? null : refreshedProvider.performance.arrivalRate,
        reliabilityScore: refreshedProvider.performance.reliabilityScore || 100,
        cancellationScore: refreshedProvider.performance.cancellationScore || 100,
        onTimeResponseScore: refreshedProvider.performance.onTimeResponseScore || 100,
        healthScore: healthScore === -1 ? null : healthScore,
        healthStatus,
        averageArrivalTime: avgArrivalLabel,
        averageJobDuration: avgDurationLabel,
        mostRequestedService: refreshedProvider.servicesOffered[0] || 'N/A',
        tier: refreshedProvider.tier,
        tierProgress: 0.75,
        rating: refreshedProvider.ratingCount < 5 ? null : refreshedProvider.ratingAvg, // Issue 1: Hide until 5 jobs
        ratingCount: refreshedProvider.ratingCount || 0,
        isProbationActive: (refreshedProvider.ratingCount || 0) < 5,
        rankNational: refreshedProvider.performance.rankNational,
        rankProvince: refreshedProvider.performance.rankProvince,
        rankCity: refreshedProvider.performance.rankCity,
        activeSince: (refreshedProvider.userId as any).createdAt,
        lastActive: refreshedProvider.lastOnlineAt,
        recentBadges: badges.map(b => b.name),
        verificationStatus: refreshedProvider.verificationStatus,
        isGhostMode: false,
        isOnline: refreshedProvider.isOnline
    };
};

const getProviderNetEarnings = async (userId: string, startDate: Date) => {
    const results = await Ledger.aggregate([
        {
            $match: {
                $or: [
                    { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE },
                    { fromUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.COMMISSION }
                ],
                createdAt: { $gte: startDate },
                status: 'COMPLETED'
            }
        },
        {
            $group: {
                _id: null,
                gross: { $sum: { $cond: [{ $eq: ["$type", TransactionType.SERVICE_FEE] }, "$amount", 0] } },
                commission: { $sum: { $cond: [{ $eq: ["$type", TransactionType.COMMISSION] }, "$amount", 0] } }
            }
        },
        {
            $project: {
                total: { $subtract: ["$gross", "$commission"] }
            }
        }
    ]);

    return results[0]?.total || 0;
};

export const handleJobCompletionQuality = async (userId: string) => {
    const provider = await Provider.findOne({ userId });
    if (!provider) return;

    provider.performance.consecutiveCompletedJobs = (provider.performance.consecutiveCompletedJobs || 0) + 1;

    if (provider.performance.consecutiveCompletedJobs >= 10) {
        // Milestone reached: 10 consecutive jobs
        const oldReliability = provider.performance.reliabilityScore;
        if (oldReliability < 100) {
            provider.performance.reliabilityScore = Math.min(100, oldReliability + 1);

            await recordAdjustment({
                providerId: provider._id.toString(),
                userId: userId,
                scoreType: PerformanceScoreType.RELIABILITY,
                oldScore: oldReliability,
                newScore: provider.performance.reliabilityScore,
                adjustmentPoints: 1,
                reason: 'Reliability boost for 10 consecutive completed jobs.'
            });

            await notifyUser(userId, 'Reliability Boost!', 'You earned +1 reliability point for completing 10 consecutive jobs.');
        }
        provider.performance.consecutiveCompletedJobs = 0; // Reset counter
    }

    await provider.save();
    await recalculateProviderMetrics(provider._id.toString());
};

export const getHealthStatus = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Very Good';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Needs Improvement';
    return 'Suspension Risk';
};

export const recordPenalty = async (userId: string, reason: string, jobId?: string) => {
    const provider = await Provider.findOne({ userId });
    if (!provider) return;

    const oldReliability = provider.performance.reliabilityScore;
    const oldOnTime = provider.performance.onTimeResponseScore;
    let points = 0;
    let type = PerformanceScoreType.RELIABILITY;

    // Reset consecutive completion count on any penalty
    provider.performance.consecutiveCompletedJobs = 0;

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

        // Corrected Cancellation Score (Percentage-based)
        const oldCancellation = provider.performance.cancellationScore || 100;
        provider.performance.cancellationScore = Math.max(0, oldCancellation + points);

        // Track raw count for dashboard (ISSUE 1 & 4)
        provider.performance.cancellationCount = (provider.performance.cancellationCount || 0) + 1;

        provider.performance.reliabilityScore = Math.max(0, (provider.performance.reliabilityScore || 100) + points);

        await recordAdjustment({
            providerId: provider._id.toString(),
            userId,
            scoreType: PerformanceScoreType.CANCELLATION,
            oldScore: oldCancellation,
            newScore: provider.performance.cancellationScore,
            adjustmentPoints: points,
            reason: jobId ? `Cancelled Job ${jobId.slice(-6)} during negotiation.` : 'Repeated cancellations.',
            jobId
        });
    }

    await provider.save();
    logger.info(`PERFORMANCE | PENALTY_RECORDED | User: ${userId} | Reason: ${reason} | New Reliability: ${provider.performance.reliabilityScore}`);
};

export const evaluateTier = async (providerId: string, session?: mongoose.ClientSession) => {
    const provider = await Provider.findById(providerId).session(session || null);
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
        await provider.save({ session });

        await ProviderTierHistory.create([{
            providerId: provider._id,
            oldTier,
            newTier,
            reason: isUpgrade ? 'Performance Upgrade' : 'Performance Downgrade',
            countryCode: (provider as any).countryCode || 'ZA'
        }], { session });

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

export const checkAndAwardBadges = async (providerId: string, session?: mongoose.ClientSession, existingProvider?: any) => {
    const provider = existingProvider || await Provider.findById(providerId).session(session || null);
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
        const existing = await ProviderBadge.findOne({ providerId: provider._id, badgeCode: b.code }).session(session || null);
        if (!existing) {
            await ProviderBadge.create([{
                providerId: provider._id,
                badgeCode: b.code,
                name: b.name,
                description: b.desc,
                iconUrl: b.icon
            }], { session });

            setImmediate(async () => {
                await notifyUser(provider.userId.toString(), 'New Badge Earned!', `Congratulations! You have earned the ${b.name} badge.`, { type: 'BADGE_EARNED', badgeCode: b.code });
            });
            emitToUser(provider.userId.toString(), 'BADGE_EARNED', { badgeCode: b.code, name: b.name });
        }
    }
};

export const recoverScores = async () => {
    // Score recovery for consistently improving providers
    // Logic: If no penalties in the last 7 days and current score < 100, boost slightly.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const providers = await Provider.find({
        $or: [
            { 'performance.reliabilityScore': { $lt: 100 } },
            { 'performance.cancellationScore': { $lt: 100 } }
        ]
    });

    for (const provider of providers) {
        const recentAdjustments = await PerformanceAdjustment.countDocuments({
            providerId: provider._id,
            adjustmentPoints: { $lt: 0 },
            createdAt: { $gte: sevenDaysAgo }
        });

        if (recentAdjustments === 0) {
            const oldReliability = provider.performance.reliabilityScore;
            const oldCancellation = provider.performance.cancellationScore;

            provider.performance.reliabilityScore = Math.min(100, provider.performance.reliabilityScore + 2);
            provider.performance.cancellationScore = Math.min(100, (provider.performance.cancellationScore || 100) + 2);

            if (oldReliability !== provider.performance.reliabilityScore || oldCancellation !== provider.performance.cancellationScore) {
                await recordAdjustment({
                    providerId: provider._id.toString(),
                    userId: provider.userId.toString(),
                    scoreType: PerformanceScoreType.RELIABILITY,
                    oldScore: oldReliability,
                    newScore: provider.performance.reliabilityScore,
                    adjustmentPoints: 2,
                    reason: 'Performance recovery due to consistent professional conduct.'
                });
                await provider.save();

                await notifyUser(provider.userId.toString(), 'Performance Recovery', 'Your performance scores have improved due to your consistent professional conduct.');
            }
        }
    }
};

export const getProviderAnalytics = async (providerId: string, period: '7d' | '30d' | '90d' | 'all') => {
    const provider = await Provider.findById(providerId).populate('userId', 'firstName lastName createdAt');
    if (!provider) return null;

    let startDate = new Date(0);
    const now = new Date();
    if (period === '7d') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (period === '30d') startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    else if (period === '90d') startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [adjustments, jobs, earnings, badges] = await Promise.all([
        PerformanceAdjustment.find({ providerId, createdAt: { $gte: startDate } }).sort({ createdAt: -1 }),
        Job.find({ providerId: provider.userId, createdAt: { $gte: startDate } }),
        mongoose.model('Ledger').aggregate([
            { $match: { toUserId: provider.userId, type: 'SERVICE_FEE', createdAt: { $gte: startDate }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]),
        ProviderBadge.find({ providerId }).sort({ earnedAt: -1 })
    ]);

    const stats = await getFullProviderStats(provider.userId.toString());
    if (!stats) return null;

    return {
        ...stats,
        lifetimeEarnings: earnings[0]?.total || stats.earningsLifetime,
        totalJobsAccepted: stats.jobsAccepted,
        totalJobsCompleted: stats.jobsCompleted,
        totalJobsCancelled: stats.cancellationCount,
        ratingTrend: [],
        reliabilityTrend: [],
        tierProgression: 75
    };
};

export const calculateRankings = async (countryCode: string = 'ZA') => {
    // 1. National Rankings (Exclude providers in probation)
    const national = await Provider.find({ countryCode, jobsCompleted: { $gte: 5 } })
        .sort({ 'performance.healthScore': -1, 'jobsCompleted': -1 })
        .select('_id');

    // Reset rankings for everyone else (e.g. those who fell below threshold or are new)
    await Provider.updateMany({ countryCode, jobsCompleted: { $lt: 5 } }, { $set: { 'performance.rankNational': 0, 'performance.rankProvince': 0, 'performance.rankCity': 0 } });

    const updates = national.map((p, index) => ({
        updateOne: {
            filter: { _id: p._id },
            update: { $set: { 'performance.rankNational': index + 1 } }
        }
    }));

    if (updates.length > 0) await Provider.bulkWrite(updates);

    // 2. Province/City Rankings
    const users = await mongoose.model('User').find({ countryCode, role: 'PROVIDER' }).select('_id province city');
    const provinceMap: Record<string, string[]> = {};
    const cityMap: Record<string, string[]> = {};

    users.forEach(u => {
        if (u.province) {
            provinceMap[u.province] = provinceMap[u.province] || [];
            provinceMap[u.province].push(u._id.toString());
        }
        if (u.city) {
            cityMap[u.city] = cityMap[u.city] || [];
            cityMap[u.city].push(u._id.toString());
        }
    });

    for (const province of Object.keys(provinceMap)) {
        const provProviders = await Provider.find({ userId: { $in: provinceMap[province] }, jobsCompleted: { $gte: 5 } })
            .sort({ 'performance.healthScore': -1, 'jobsCompleted': -1 })
            .select('_id');

        const provUpdates = provProviders.map((p, index) => ({
            updateOne: {
                filter: { _id: p._id },
                update: { $set: { 'performance.rankProvince': index + 1 } }
            }
        }));
        if (provUpdates.length > 0) await Provider.bulkWrite(provUpdates);
    }

    for (const city of Object.keys(cityMap)) {
        const cityProviders = await Provider.find({ userId: { $in: cityMap[city] }, jobsCompleted: { $gte: 5 } })
            .sort({ 'performance.healthScore': -1, 'jobsCompleted': -1 })
            .select('_id');

        const cityUpdates = cityProviders.map((p, index) => ({
            updateOne: {
                filter: { _id: p._id },
                update: { $set: { 'performance.rankCity': index + 1 } }
            }
        }));
        if (cityUpdates.length > 0) await Provider.bulkWrite(cityUpdates);
    }
};

export const takePerformanceSnapshot = async (countryCode: string) => {
    const providers = await Provider.find(); // Ideally filtered by countryCode if available on Provider
    const now = new Date();

    await calculateRankings(countryCode);

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
