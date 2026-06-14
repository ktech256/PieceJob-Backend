import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import NotificationLog from '../models/Notification';

export const sendPushNotification = async (
    userId: string,
    fcmToken: string,
    title: string,
    body: string,
    data: any = {}
) => {
    const eventId = uuidv4();
    const payload: admin.messaging.Message = {
        notification: { title, body },
        data: {
            ...data,
            eventId,
            timestamp: new Date().toISOString()
        },
        token: fcmToken
    };

    try {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT missing');
        }

        const response = await admin.messaging().send(payload);

        console.log(`FCM Sent to ${userId} with messageId: ${response}`);

        await NotificationLog.create({
            userId,
            title,
            body,
            type: 'PUSH',
            status: 'SENT',
            payload: { ...data, messageId: response }
        });

        return { success: true, messageId: response };
    } catch (error) {
        console.error('FCM Error:', error);
        await NotificationLog.create({
            userId,
            title,
            body,
            type: 'PUSH',
            status: 'FAILED',
            payload: { error: (error as Error).message, ...data }
        });
        return { success: false, error: (error as Error).message };
    }
};

import User from '../models/User';

export const notifyUser = async (userId: string, title: string, body: string, data: any = {}) => {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken) return;
    return await sendPushNotification(userId, user.fcmToken, title, body, data);
};

export const broadcastToProviders = async (fcmTokens: string[], title: string, body: string, jobData: any): Promise<admin.messaging.BatchResponse | undefined> => {
    if (fcmTokens.length === 0) return;

    const message: admin.messaging.MulticastMessage = {
        notification: { title, body },
        data: jobData,
        tokens: fcmTokens
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`Broadcasted to ${response.successCount} providers. Failures: ${response.failureCount}`);
        return response;
    } catch (error) {
        console.error('Broadcast Error:', error);
    }
};
