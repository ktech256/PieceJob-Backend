import admin from 'firebase-admin';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import NotificationLog from '../models/Notification';
import User from '../models/User';
import { logger } from '../utils/logger';
import { isUserConnected, emitToUser } from '../socket/socket.service';

export const sendPushNotification = async (
    userId: string,
    fcmToken: string,
    title: string,
    body: string,
    data: any = {},
    dataOnly: boolean = false
) => {
    const eventId = uuidv4();

    const payload: admin.messaging.Message = {
        data: {
            ...data,
            title,
            body,
            eventId,
            timestamp: new Date().toISOString()
        },
        token: fcmToken,
        android: {
            priority: 'high'
        }
    };

    if (!dataOnly) {
        payload.notification = { title, body };
    }

    try {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT missing');
        }

        const response = await admin.messaging().send(payload);

        logger.fcm('SENT', 'SUCCESS', userId, `MsgId: ${response}`);

        await NotificationLog.create({
            userId,
            title,
            body,
            type: 'PUSH',
            status: 'SENT',
            payload: { ...data, messageId: response, dataOnly }
        });

        return { success: true, messageId: response };
    } catch (error: any) {
        logger.error(`FCM | SEND_FAILED | User: ${userId} | Code: ${error.code} | Msg: ${error.message}`);

        if (error.code === 'messaging/registration-token-not-registered') {
            logger.warn(`FCM | TOKEN_EXPIRED | Cleaning up user ${userId}`);
            await User.findByIdAndUpdate(userId, { fcmToken: null });

            // FORENSIC REPAIR: Check if user is still reachable via Socket
            const isConnected = isUserConnected(userId);

            if (isConnected) {
                logger.info(`FCM | TOKEN_REPAIR | User ${userId} is connected via Socket. Requesting token refresh.`);
                emitToUser(userId, 'FORCE_REPAIR_FCM', { reason: 'stale_token' });
            } else {
                // Only mark offline if NOT connected via Socket
                logger.warn(`FCM | OFFLINE_REPAIR | User ${userId} is unreachable via FCM and Socket. Forcing offline.`);
                const Provider = mongoose.model('Provider');
                await Provider.findOneAndUpdate({ userId }, { isOnline: false, currentAvailabilityStatus: 'OFFLINE' });
            }
        }

        await NotificationLog.create({
            userId,
            title,
            body,
            type: 'PUSH',
            status: 'FAILED',
            payload: { error: error.message, code: error.code, ...data, dataOnly }
        });
        return { success: false, error: error.message };
    }
};

export const notifyUser = async (userId: any, title: string, body: string, data: any = {}, dataOnly: boolean = false) => {
    const targetId = userId?._id || userId;

    if (!targetId || typeof targetId === 'object' && !mongoose.Types.ObjectId.isValid(targetId)) {
        logger.error(`FCM | FAILED: Invalid User ID passed: ${userId}`);
        return;
    }

    const user = await User.findById(targetId);

    if (!user) {
        logger.error(`FCM | FAILED: User ${targetId} not found.`);
        return;
    }

    if (!user.fcmToken) {
        logger.warn(`FCM | SKIPPED: User ${targetId} (${user.email}) has NO FCM token.`);
        return;
    }

    return await sendPushNotification(targetId.toString(), user.fcmToken, title, body, data, dataOnly);
};

export const broadcastToProviders = async (fcmTokens: string[], title: string, body: string, jobData: any): Promise<admin.messaging.BatchResponse | undefined> => {
    if (fcmTokens.length === 0) return;

    console.log(`[FCM_AUDIT] Multicast to ${fcmTokens.length} tokens.`);

    const message: admin.messaging.MulticastMessage = {
        notification: { title, body },
        data: jobData,
        tokens: fcmTokens,
        android: {
            priority: 'high'
        }
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`[FCM_AUDIT] Multicast Success: ${response.successCount}, Failure: ${response.failureCount}`);
        return response;
    } catch (error) {
        console.error('[FCM_AUDIT] Multicast Fatal Error:', error);
    }
};

export const notifyDevices = async (tokens: string[], title: string, body: string, data: any = {}) => {
    if (tokens.length === 0) return;

    const message: admin.messaging.MulticastMessage = {
        notification: { title, body },
        data: {
            ...data,
            timestamp: new Date().toISOString()
        },
        tokens,
        android: {
            priority: 'high'
        }
    };

    try {
        return await admin.messaging().sendEachForMulticast(message);
    } catch (error) {
        logger.error(`FCM | MULTICAST_FAILED | Error: ${error}`);
    }
};
