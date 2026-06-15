import Provider from '../models/Provider';
import { emitAdminUpdate } from '../socket/socket.service';
import * as fraudService from './fraud.service';
import Job, { JobStatus } from '../models/Job';
import * as notificationService from './notification.service';

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

        // SECTION: JOB TRACKING & ETA (PAGE 5)
        const activeJob = await Job.findOne({
            providerId: userId,
            status: { $in: [JobStatus.ACCEPTED, JobStatus.PROVIDER_ACCEPTED, JobStatus.EN_ROUTE] }
        });

        if (activeJob) {
            const distance = calculateDistance(coordinates, activeJob.location.coordinates);
            const etaMinutes = Math.ceil(distance / 500); // 30km/h avg = 500m/min

            // Arrival Notifications
            if (distance <= 30) {
                await notificationService.notifyUser(activeJob.customerId.toString(), 'Provider has arrived', 'Your provider is at the location.');
                activeJob.status = JobStatus.ARRIVED;
                await activeJob.save();
            } else if (distance <= 1000 && distance > 500) {
                // ~5 mins away
                await notificationService.notifyUser(activeJob.customerId.toString(), 'Provider is almost there', 'Your provider is approximately 5 minutes away.');
            } else if (distance <= 5000 && distance > 4500) {
                // ~10 mins away
                await notificationService.notifyUser(activeJob.customerId.toString(), 'Provider is 10 minutes away', 'Your provider will arrive in approximately 10 minutes.');
            }
        }
    }
    return provider;
};

function calculateDistance(c1: number[], c2: number[]) {
    const R = 6371e3; // meters
    const lat1 = c1[1] * Math.PI/180;
    const lat2 = c2[1] * Math.PI/180;
    const dLat = (c2[1]-c1[1]) * Math.PI/180;
    const dLon = (c2[0]-c1[0]) * Math.PI/180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in meters
}

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
