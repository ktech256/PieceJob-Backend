import SystemSettings, { ISystemSettings } from '../models/SystemSettings';

const settingsCache = new Map<string, { data: ISystemSettings, expiry: number }>();
const CACHE_TTL = 300000; // 5 minutes

export const getSettings = async (countryCode: string = 'GLOBAL'): Promise<ISystemSettings> => {
  const now = Date.now();
  const cached = settingsCache.get(countryCode);

  if (cached && cached.expiry > now) {
    return cached.data;
  }

  let settings = await SystemSettings.findOne({ countryCode }).lean();

  if (!settings && countryCode !== 'GLOBAL') {
    // Fallback to global if country specific not found
    settings = await SystemSettings.findOne({ countryCode: 'GLOBAL' }).lean();
  }

  if (!settings) {
    // FOR PRODUCTION SAFETY: Do not auto-create in a read path to avoid write-conflicts and violating read-only GETs.
    // Use a hardcoded default object if even GLOBAL is missing.
    return {
        countryCode: 'GLOBAL',
        matchingRadiusKm: 10,
        platformServiceFeePercent: 15,
        referralProgramEnabled: true,
        // ... include other critical defaults
    } as ISystemSettings;
  }

  settingsCache.set(countryCode, { data: settings as ISystemSettings, expiry: now + CACHE_TTL });
  return settings as ISystemSettings;
};

export const updateSettings = async (countryCode: string, data: Partial<ISystemSettings>): Promise<ISystemSettings> => {
  const settings = await SystemSettings.findOneAndUpdate(
    { countryCode },
    { ...data, $inc: { version: 1 } },
    { new: true, upsert: true }
  );

  // Invalidate cache
  settingsCache.delete(countryCode);
  settingsCache.delete('GLOBAL');

  return settings;
};
