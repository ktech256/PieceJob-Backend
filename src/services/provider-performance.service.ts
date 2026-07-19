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
    await calculateHealthScore(provider._id.toString());
    return provider;
};

export const calculateHealthScore = async (providerId: string) => {
    const provider = await Provider.findById(providerId);
    if (!provider) return 0;

    // ISSUE 2: REDESIGNED HEALTH SCORE FORMULA
    // Weighting: Rating (25%), Reliability (25%), Acceptance (20%), Cancellation (15%), Arrival (15%)
    const ratingComp = (provider.ratingAvg / 5) * 25;
    const reliabilityComp = (provider.performance.reliabilityScore || 100) * 0.25;
    const acceptanceComp = (provider.performance.acceptanceRate || 0) * 0.20;
    const cancellationComp = (provider.performance.cancellationScore || 100) * 0.15;
    const arrivalComp = (provider.performance.arrivalRate || 0) * 0.15;

    const healthScore = Math.min(100, Math.max(0, ratingComp + reliabilityComp + acceptanceComp + cancellationComp + arrivalComp));

    const oldHealth = (provider.performance as any).healthScore || 100;

    // Update provider in memory (will be saved in snapshot or other triggers)
    // For live tracking, let's update it now.
    await Provider.updateOne({ _id: providerId }, { $set: { 'performance.healthScore': healthScore } });

    if (Math.abs(oldHealth - healthScore) >= 5) {
        const status = getHealthStatus(healthScore);
        await notifyUser(provider.userId.toString(), 'Health Score Update', `Your overall health score is now ${healthScore.toFixed(0)}% (${status}).`);
    }

    return healthScore;
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

    const completedJobs = jobs.filter(j => j.status === JobStatus.COMPLETED || j.status === JobStatus.RATED || j.status === JobStatus.CLOSED);
    const cancelledJobs = jobs.filter(j => j.status === JobStatus.CANCELLED);

    // Calculate Average Arrival Time & Duration
    let totalArrivalMin = 0;
    let arrivedCount = 0;
    let totalDurationMin = 0;
    let durationCount = 0;

    completedJobs.forEach(j => {
        if (j.acceptedAt && j.arrivedAt) {
            totalArrivalMin += (j.arrivedAt.getTime() - j.acceptedAt.getTime()) / (1000 * 60);
            arrivedCount++;
        }
        if (j.startedAt && j.completedAt) {
            totalDurationMin += (j.completedAt.getTime() - j.startedAt.getTime()) / (1000 * 60);
            durationCount++;
        }
    });

    const avgArrival = arrivedCount > 0 ? Math.round(totalArrivalMin / arrivedCount) : 0;
    const avgDuration = durationCount > 0 ? Math.round(totalDurationMin / durationCount) : 0;

    return {
        dailyEarnings: [], // Fill with real chart points if needed
        weeklyEarnings: [],
        monthlyEarnings: [],
        lifetimeEarnings: earnings[0]?.total || 0,
        totalJobsAccepted: provider.performance.acceptedJobs,
        totalJobsCompleted: provider.performance.completedJobs,
        totalJobsCancelled: provider.performance.cancellationScore,
        acceptanceRate: provider.performance.acceptanceRate,
        completionRate: provider.performance.completionRate,
        arrivalRate: provider.performance.arrivalRate,
        reliabilityScore: provider.performance.reliabilityScore,
        cancellationScore: provider.performance.cancellationScore,
        healthScore: provider.performance.healthScore,
        healthStatus: getHealthStatus(provider.performance.healthScore),
        averageArrivalTime: `${avgArrival} mins`,
        averageJobDuration: `${avgDuration} mins`,
        currentRank: provider.performance.rankNational || 0,
        cityRank: provider.performance.rankCity || 0,
        provinceRank: provider.performance.rankProvince || 0,
        badges: badges.map(b => b.name),
        mostRequestedService: provider.servicesOffered[0] || 'N/A',
        activeSince: (provider.userId as any).createdAt?.toLocaleDateString() || 'N/A',
        lastActive: provider.lastOnlineAt?.toLocaleString() || 'N/A',
        ratingTrend: [],
        reliabilityTrend: [],
        tierProgression: 75
    };
};

export const calculateRankings = async (countryCode: string = 'ZA') => {
    // 1. National Rankings
    const national = await Provider.find({ countryCode })
        .sort({ 'performance.healthScore': -1, 'jobsCompleted': -1 })
        .select('_id');

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
        const provProviders = await Provider.find({ userId: { $in: provinceMap[province] } })
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
        const cityProviders = await Provider.find({ userId: { $in: cityMap[city] } })
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
