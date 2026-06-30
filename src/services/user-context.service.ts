import User from '../models/User';

export const trackJobAddress = async (userId: string, address: string, coordinates: number[]) => {
    try {
        const user = await User.findById(userId);
        if (!user) return;

        if (!user.addresses) user.addresses = [];

        // Simple match by address string.
        const existingIndex = user.addresses.findIndex(a => a.address === address);
        if (existingIndex > -1) {
            const currentCount = user.addresses[existingIndex].usageCount || 0;
            user.addresses[existingIndex].usageCount = currentCount + 1;
            user.addresses[existingIndex].lastUsedAt = new Date();
        } else {
            user.addresses.push({
                label: 'Recent Address',
                address,
                coordinates,
                isDefault: user.addresses.length === 0,
                usageCount: 1,
                lastUsedAt: new Date()
            });
        }

        await user.save();
    } catch (error) {
        console.error('[USER_CONTEXT_SERVICE] trackJobAddress failed:', error);
    }
};

export const autoSaveLocation = async (userId: string, address: string, coordinates: number[]) => {
    try {
        const user = await User.findById(userId);
        if (!user) return;

        if (!user.savedLocations) user.savedLocations = [];

        const existingIndex = user.savedLocations.findIndex(l => l.address === address);
        if (existingIndex > -1) {
            const currentCount = user.savedLocations[existingIndex].usageCount || 0;
            user.savedLocations[existingIndex].usageCount = currentCount + 1;
            user.savedLocations[existingIndex].lastUsedAt = new Date();
        } else {
            if (user.savedLocations.length >= 5) {
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
                address,
                coordinates,
                usageCount: 1,
                lastUsedAt: new Date()
            });
        }

        await user.save();
    } catch (error) {
        console.error('[USER_CONTEXT_SERVICE] autoSaveLocation failed:', error);
    }
};
