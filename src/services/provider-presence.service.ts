import Provider from '../models/Provider';
import { emitAdminUpdate } from '../socket/socket.service';
import * as fraudService from './fraud.service';

export const handleHeartbeat = async (userId: string, coordinates: number[], hardwareId?: string, isMock?: boolean) => {
    const now = new Date();
    const oldProvider = await Provider.findOne({ userId });

    const provider = await Provider.findOneAndUpdate(
        { userId },
        {
            isOnline: true,
            lastHeartbeat: now,
            lastGpsUpdate: now,
            'location.coordinates': coordinates,
            hardwareId
        },
        { new: true }
    );

    if (provider && oldProvider) {
        // PAGE 12: Fraud Checks
        if (isMock) {
            await fraudService.applyShadowBan(provider._id.toString(), 'Mock GPS detected');
        }

        if (hardwareId) {
            await fraudService.checkMultiAccountDevice(provider._id.toString(), hardwareId);
        }

        // GPS Integrity Check
        if (oldProvider.lastGpsUpdate) {
            const timeDiffSec = (now.getTime() - oldProvider.lastGpsUpdate.getTime()) / 1000;
            await fraudService.checkGpsIntegrity(
                provider._id.toString(),
                coordinates,
                oldProvider.location.coordinates,
                timeDiffSec
            );
        }

        emitAdminUpdate('provider_presence_update', {
            providerId: provider._id,
            userId,
            isOnline: true,
            lastHeartbeat: now,
            coordinates
        });
    }
    return provider;
};

export const checkGhostOffline = async () => {
    const sixtySecondsAgo = new Date(Date.now() - 60000);

    // Providers who haven't sent a heartbeat in 60s but are still marked online
    const ghosts = await Provider.find({
        isOnline: true,
        lastHeartbeat: { $lt: sixtySecondsAgo }
    });

    for (const ghost of ghosts) {
        ghost.isOnline = false;
        await ghost.save();

        emitAdminUpdate('provider_presence_update', {
            providerId: ghost._id,
            userId: ghost.userId,
            isOnline: false,
            status: 'GHOST_OFFLINE',
            lastHeartbeat: ghost.lastHeartbeat
        });
    }

    return ghosts.length;
};
