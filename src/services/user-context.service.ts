import User from '../models/User';

export const trackJobAddress = async (userId: string, address: string, coordinates: number[]) => {
    try {
        const cleanAddress = address.trim().toLowerCase();
        console.log(`[FORENSIC] TRACK_ADDRESS | User: ${userId} | Address: ${cleanAddress}`);
        const user = await User.findById(userId);
        if (!user) {
            console.error(`[FORENSIC] TRACK_ADDRESS | User ${userId} not found`);
            return;
        }

        if (!user.addresses) user.addresses = [];

        // Improved match by trimmed/lowercased address string.
        const existingIndex = user.addresses.findIndex(a => a.address.trim().toLowerCase() === cleanAddress);
        if (existingIndex > -1) {
            const currentCount = user.addresses[existingIndex].usageCount || 0;
            user.addresses[existingIndex].usageCount = currentCount + 1;
            user.addresses[existingIndex].lastUsedAt = new Date();
            user.markModified('addresses');
            console.log(`[FORENSIC] TRACK_ADDRESS | Incremented existing address usage to ${user.addresses[existingIndex].usageCount}`);
        } else {
            user.addresses.push({
                label: 'Recent Address',
                address: address.trim(),
                coordinates,
                isDefault: user.addresses.length === 0,
                usageCount: 1,
                lastUsedAt: new Date()
            });
            console.log(`[FORENSIC] TRACK_ADDRESS | Added new address to tracking`);
        }

        await user.save();
        console.log(`[FORENSIC] TRACK_ADDRESS | Save Success.`);
    } catch (error) {
        console.error('[USER_CONTEXT_SERVICE] trackJobAddress failed:', error);
    }
};

export const autoSaveLocation = async (userId: string, address: string, coordinates: number[]) => {
    try {
        const cleanAddress = address.trim().toLowerCase();
        console.log(`[FORENSIC] AUTO_SAVE_LOCATION | User: ${userId} | Address: ${cleanAddress}`);
        const user = await User.findById(userId);
        if (!user) {
            console.error(`[FORENSIC] AUTO_SAVE_LOCATION | User ${userId} not found`);
            return;
        }

        if (!user.savedLocations) user.savedLocations = [];

        const existingIndex = user.savedLocations.findIndex(l => l.address.trim().toLowerCase() === cleanAddress);
        if (existingIndex > -1) {
            const currentCount = user.savedLocations[existingIndex].usageCount || 0;
            user.savedLocations[existingIndex].usageCount = currentCount + 1;
            user.savedLocations[existingIndex].lastUsedAt = new Date();
            user.markModified('savedLocations');
            console.log(`[FORENSIC] AUTO_SAVE_LOCATION | Incremented usage of existing location to ${user.savedLocations[existingIndex].usageCount}`);
        } else {
            if (user.savedLocations.length >= 5) {
                console.log(`[FORENSIC] AUTO_SAVE_LOCATION | Max locations (5) reached. Evicting oldest.`);
                // Remove oldest (by lastUsedAt)
                user.savedLocations.sort((a, b) => {
                    const timeA = a.lastUsedAt?.getTime() || 0;
                    const timeB = b.lastUsedAt?.getTime() || 0;
                    return timeA - timeB;
                });
                user.savedLocations.shift();
            }

            user.savedLocations.push({
                name: address.split(',')[0] || 'Saved Location',
                address: address.trim(),
                coordinates,
                usageCount: 1,
                lastUsedAt: new Date()
            });
            console.log(`[FORENSIC] AUTO_SAVE_LOCATION | Added new location`);
        }

        await user.save();
        console.log(`[FORENSIC] AUTO_SAVE_LOCATION | Save Success.`);
    } catch (error) {
        console.error('[USER_CONTEXT_SERVICE] autoSaveLocation failed:', error);
    }
};
