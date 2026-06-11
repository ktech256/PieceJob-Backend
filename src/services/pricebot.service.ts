import Job, { JobStatus } from '../models/Job';
import PriceBotSuggestion from '../models/PriceBotSuggestion';
import Zone from '../models/Zone';
import SystemSettings from '../models/SystemSettings';

export const runPriceBotAnalysis = async (countryCode: string) => {
    const settings = await SystemSettings.findOne({ countryCode });
    if (!settings) return;

    const zones = await Zone.find({ countryCode, isActive: true });

    for (const zone of zones) {
        // Analysis: Calculate Supply vs Demand
        const demand = await Job.countDocuments({
            countryCode,
            cityOrZoneId: zone._id,
            status: { $in: [JobStatus.BROADCASTED, JobStatus.ACCEPTED] },
            createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 mins
        });

        // Simplified Supply check: providers who were active/online recently in this zone
        // For now, let's just use a random factor for simulation or real online provider count
        const supply = 5; // Placeholder for online providers in zone

        if (demand > supply * 2) {
            const suggestedMultiplier = 1.2 + (demand / 20); // Basic logic

            // Check if suggestion already exists
            const existing = await PriceBotSuggestion.findOne({
                countryCode,
                zoneId: zone._id as any,
                status: 'PENDING'
            });

            if (!existing) {
                await PriceBotSuggestion.create({
                    countryCode,
                    zoneId: zone._id as any,
                    suggestedMultiplier: Math.min(suggestedMultiplier, settings.surgeMultiplierMax),
                    reason: `Demand spike detected: ${demand} active jobs vs ${supply} providers.`,
                    demandLevel: demand > 20 ? 'CRITICAL' : 'HIGH',
                    supplyLevel: 'LOW'
                });
            }
        }
    }
};
