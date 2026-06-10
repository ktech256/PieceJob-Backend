import FeatureFlag from '../models/FeatureFlag';
import mongoose from 'mongoose';

export const isFeatureEnabled = async (key: string, countryCode: string, userId?: string): Promise<boolean> => {
    const flag = await FeatureFlag.findOne({ key });
    if (!flag) return false;

    if (flag.disabledCountries.includes(countryCode)) return false;
    if (flag.isEnabledGlobal) return true;
    if (flag.enabledCountries.includes(countryCode)) return true;

    if (userId) {
        if (flag.enabledUserIds.includes(new mongoose.Types.ObjectId(userId))) return true;

        // Simple hash-based rollout
        const userHash = parseInt(userId.slice(-2), 16);
        if (userHash % 100 < flag.rolloutPercentage) return true;
    }

    return false;
};
