import Provider, { ProviderTier } from '../models/Provider';
import ProviderPerformance from '../models/ProviderPerformance';
import ProviderTierHistory from '../models/ProviderTierHistory';
import { emitToUser } from '../socket/socket.service';
import { notifyUser } from './notification.service';

export const recalculateProviderMetrics = async (providerId: string) => {
    const provider = await Provider.findById(providerId);
    if (!provider) return null;

    const perf = provider.performance;

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

    await provider.save();
    return provider;
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
            periodStart: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
            periodEnd: now,
            countryCode: (provider as any).countryCode || 'ZA'
        });
    }
};
