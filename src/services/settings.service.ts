import SystemSettings, { ISystemSettings } from '../models/SystemSettings';

export const getSettings = async (countryCode: string = 'GLOBAL'): Promise<ISystemSettings> => {
  let settings = await SystemSettings.findOne({ countryCode });

  if (!settings && countryCode !== 'GLOBAL') {
    // Fallback to global if country specific not found
    settings = await SystemSettings.findOne({ countryCode: 'GLOBAL' });
  }

  if (!settings) {
    // Initialize defaults if nothing exists
    settings = await SystemSettings.create({ countryCode: 'GLOBAL' });
  }

  return settings;
};

export const updateSettings = async (countryCode: string, data: Partial<ISystemSettings>): Promise<ISystemSettings> => {
  const settings = await SystemSettings.findOneAndUpdate(
    { countryCode },
    { ...data, $inc: { version: 1 } },
    { new: true, upsert: true }
  );
  return settings;
};
