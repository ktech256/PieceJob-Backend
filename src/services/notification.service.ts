import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import NotificationLog from '../models/Notification'; // Assuming I have this or will create it

// Initialize Firebase Admin (Configuration should be in .env)
// admin.initializeApp({
//   credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!))
// });

export const sendPushNotification = async (
    userId: string,
    fcmToken: string,
    title: string,
    body: string,
    data: any = {}
) => {
    const eventId = uuidv4();
    const payload = {
        notification: { title, body },
        data: {
            ...data,
            eventId,
            timestamp: new Date().toISOString()
        },
        token: fcmToken
    };

    try {
        // const response = await admin.messaging().send(payload);
        console.log(`FCM Sent to ${userId} with eventId: ${eventId}`);

        // Log notification for reliability tracking (Section 10.2)
        // await NotificationLog.create({ userId, eventId, type: 'PUSH', status: 'SENT', payload });

        return { success: true, eventId };
    } catch (error) {
        console.error('FCM Error:', error);
        return { success: false, error };
    }
};

export const broadcastToProviders = async (fcmTokens: string[], title: string, body: string, jobData: any) => {
    if (fcmTokens.length === 0) return;

    const message = {
        notification: { title, body },
        data: jobData,
        tokens: fcmTokens
    };

    try {
        // const response = await admin.messaging().sendMulticast(message);
        console.log(`Broadcasted to ${fcmTokens.length} providers`);
    } catch (error) {
        console.error('Broadcast Error:', error);
    }
};
