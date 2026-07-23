import Provider from '../models/Provider';
import User from '../models/User';
import { emitAdminUpdate, isUserConnected, emitToUser } from '../socket/socket.service';
import * as fraudService from './fraud.service';
import Job, { JobStatus } from '../models/Job';
import * as notificationService from './notification.service';
import { calculateDistance } from '../utils/location';
import { logger } from '../utils/logger';

export const handleHeartbeat = async (userId: string, coordinates: number[], hardwareId?: string, isMock?: boolean) => {
    const now = new Date();
    const oldProvider = await Provider.findOne({ userId });

    if (!oldProvider) {
        logger.error(`HEARTBEAT | FAILED | Provider not found for user: ${userId}`);
        return null;
    }

    // SELF-HEALING: If heartbeat is coming in but provider is marked offline, try to re-online them
    // only if they are approved, not suspended, and have services configured.
    let statusUpdate: any = {
        lastHeartbeat: now,
        lastGpsUpdate: now,
        'location.coordinates': coordinates,
        hardwareId
    };

    if (!oldProvider.isOnline) {
        const canAutoOnline = oldProvider.verificationStatus === 'APPROVED' &&
            (!oldProvider.suspendedUntil || oldProvider.suspendedUntil < now) &&
            oldProvider.servicesOffered.length > 0;

        if (canAutoOnline) {
            logger.info(`HEARTBEAT | SELF_HEALING | Re-onlining provider ${userId} due to active heartbeat.`);
            statusUpdate.isOnline = true;
            statusUpdate.currentAvailabilityStatus = 'ONLINE';
            statusUpdate.lastOnlineAt = now;
        }
    }

    const provider = await Provider.findOneAndUpdate(
        { userId },
        { $set: statusUpdate },
        { new: true }
    );

    if (provider) {
        logger.heartbeat(userId, provider.isOnline);

        // EVENT-DRIVEN HEALTH MONITOR: Check token health during heartbeat
        // If provider is online but has no token, request repair via Socket
        const user = await User.findById(userId).select('fcmToken');
        if (user && !user.fcmToken) {
            const isConnected = isUserConnected(userId);
            if (isConnected) {
                logger.info(`HEALTH_MONITOR | Heartbeat Token Repair | User ${userId} is Online with NO Token. Requesting repair.`);
                emitToUser(userId, 'FORCE_REPAIR_FCM', { reason: 'missing_token_on_heartbeat' });
            }
        }

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
        // Arrival only detected when provider is actually dispatched (EN_ROUTE)
        // This prevents bypassing negotiation/photos in PROVIDER_ACCEPTED state
        const activeJob = await Job.findOne({
            providerId: userId,
            status: { $in: [JobStatus.EN_ROUTE, JobStatus.PROVIDER_ACCEPTED, JobStatus.ACCEPTED] }
        });

        if (activeJob) {
            const distance = calculateDistance(coordinates, activeJob.location.coordinates);

            // Movement Monitoring (PAGE 7/8 Requirements)
            if (!activeJob.hasStartedTravelling && activeJob.providerLocationAtAcceptance) {
                const distanceFromAcceptance = calculateDistance(coordinates, activeJob.providerLocationAtAcceptance.coordinates);
                if (distanceFromAcceptance > 100) { // Moved more than 100m
                    activeJob.hasStartedTravelling = true;
                    activeJob.travellingStartedAt = now;
                    logger.info(`PRESENCE | MOVEMENT_DETECTED | Job: ${activeJob._id} | Provider: ${userId} has started travelling.`);
                }
            }

            // Arrival Notifications (Hardened to prevent spam)
            const sent = activeJob.notificationsSent || [];

            if (activeJob.status === JobStatus.EN_ROUTE) {
                if (distance <= 50 && !sent.includes('ARRIVED')) {
                    await notificationService.notifyUser(activeJob.customerId.toString(), 'Provider has arrived', 'Your provider is at the location.');
                    activeJob.status = JobStatus.ARRIVED;
                    activeJob.notificationsSent = [...sent, 'ARRIVED'];
                    await activeJob.save();

                    // Unified Real-Time Sync
                    const { syncJobStatus } = require('../socket/socket.service');
                    syncJobStatus(activeJob);
                }
                else if (distance <= 3000 && distance > 2500 && !sent.includes('ALMOST_THERE')) {
                    // ~5 mins away (approx 3km)
                    await notificationService.notifyUser(activeJob.customerId.toString(), 'Provider is almost there', 'Your provider is approximately 5 minutes away.');
                    activeJob.notificationsSent = [...sent, 'ALMOST_THERE'];

                    // PHASE 7: Recipient SMS Trigger
                    if (activeJob.isForSomeoneElse && activeJob.recipientPhone) {
                        const { sendRecipientSms } = require('./job.service');
                        sendRecipientSms(activeJob, 'NEARBY').catch((err: any) => logger.error(`RECIPIENT_NEARBY_SMS_ERROR | Job: ${activeJob._id} | ${err}`));
                    }
                }
                else if (distance <= 5000 && distance > 4500 && !sent.includes('TEN_MINUTES')) {
                    // ~10 mins away
                    await notificationService.notifyUser(activeJob.customerId.toString(), 'Provider is 10 minutes away', 'Your provider will arrive in approximately 10 minutes.');
                    activeJob.notificationsSent = [...sent, 'TEN_MINUTES'];
                }
            }

            if (activeJob.isModified()) {
                await activeJob.save();
            }
        }
    }
    return provider;
};

export const checkGhostOffline = async () => {
    // FORENSIC FIX: Increase threshold to 3 minutes to prevent aggressive ghosting
    // while app heartbeats are every 10-30s.
    const threshold = new Date(Date.now() - 3 * 60 * 1000);

    // Providers who haven't sent a heartbeat in 3m but are still marked online
    const ghosts = await Provider.find({
        isOnline: true,
        lastHeartbeat: { $lt: threshold }
    });

    for (const ghost of ghosts) {
        ghost.isOnline = false;
        ghost.currentAvailabilityStatus = 'OFFLINE';
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

/**
 * Ensures a provider is returned to the available pool if they are still online.
 * Resets currentAvailabilityStatus to ONLINE if isOnline is true.
 */
export const releaseProviderFromJob = async (userId: string) => {
    try {
        const provider = await Provider.findOne({ userId });
        if (provider) {
            provider.currentAvailabilityStatus = provider.isOnline ? 'ONLINE' : 'OFFLINE';
            await provider.save();

            emitAdminUpdate('provider_status_changed', {
                userId: userId,
                isOnline: provider.isOnline,
                status: provider.currentAvailabilityStatus,
                timestamp: new Date()
            });

            // Notify User Room so app can sync
            const { emitToUser } = require('../socket/socket.service');
            emitToUser(userId.toString(), 'provider_status_sync', {
                isOnline: provider.isOnline,
                status: provider.currentAvailabilityStatus
            });

            logger.info(`PRESENCE | RELEASE | Provider ${userId} released to ${provider.currentAvailabilityStatus}`);
        }
    } catch (error: any) {
        logger.error(`PRESENCE | RELEASE_FAILED | User: ${userId} | ${error.message}`);
    }
};
