import admin from 'firebase-admin';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import NotificationLog from '../models/Notification';
import User from '../models/User';

export const sendPushNotification = async (
    userId: string,
    fcmToken: string,
    title: string,
    body: string,
    data: any = {},
    dataOnly: boolean = false
) => {
    const eventId = uuidv4();

    console.log(`[FCM_SEND_START] Attempting send to User: ${userId}`);
    console.log(`[FCM_SEND_START] Token Fragment: ${fcmToken.substring(0, 15)}...${fcmToken.substring(fcmToken.length - 10)}`);
    console.log(`[FCM_SEND_START] Payload:`, JSON.stringify({ title, body, data }));

    const payload: admin.messaging.Message = {
        data: {
            ...data,
            title, // Include title/body in data block for data-only messages
            body,
            eventId,
            timestamp: new Date().toISOString()
        },
        token: fcmToken,
        android: {
            priority: 'high'
        }
    };

    // Only add notification block if NOT dataOnly
    if (!dataOnly) {
        payload.notification = { title, body };
    }

    try {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
            console.error('[FCM_AUDIT] FATAL: FIREBASE_SERVICE_ACCOUNT environment variable is missing.');
            throw new Error('FIREBASE_SERVICE_ACCOUNT missing');
        }

        console.log(`[FCM_SEND_START] Handing off to Firebase SDK for User ${userId}`);
        const response = await admin.messaging().send(payload);

        console.log(`[FCM_FIREBASE_RESPONSE] SUCCESS: MessageId: ${response}`);

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
        console.error('[FCM_AUDIT] FATAL ERROR:', error.code, error.message);

        // Check for specific Firebase error codes
        if (error.code === 'messaging/registration-token-not-registered') {
            console.warn(`[FCM_AUDIT] Token for user ${userId} is invalid or expired. Cleaning up...`);
            await User.findByIdAndUpdate(userId, { fcmToken: null });
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
    // Robustly extract ID if an object was passed
    const targetId = userId?._id || userId;

    if (!targetId || typeof targetId === 'object' && !mongoose.Types.ObjectId.isValid(targetId)) {
        console.error(`[FCM_AUDIT] FAILED: Invalid User ID passed to notifyUser:`, userId);
        return;
    }

    console.log(`[FCM_AUDIT] Handing off for User ${targetId}. Fetching fresh User document...`);
    const user = await User.findById(targetId);

    if (!user) {
        console.error(`[FCM_AUDIT] FAILED: Fresh lookup for User ${targetId} returned NULL.`);
        return;
    }

    if (!user.fcmToken) {
        console.error(`[FCM_AUDIT] FAILED: User ${targetId} (${user.email}) has NULL fcmToken in MongoDB.`);
        console.log(`[FCM_AUDIT] User document state:`, JSON.stringify({
            id: user._id,
            email: user.email,
            role: user.role,
            hasToken: !!user.fcmToken,
            updatedAt: user.updatedAt
        }));
        return;
    }

    console.log(`[FCM_AUDIT] SUCCESS: Token found for ${user.email}. Proceeding to Firebase SDK...`);
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
