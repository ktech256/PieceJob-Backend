import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const initializeFirebase = () => {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not found in environment variables.');
        return;
    }

    try {
        if (admin.apps.length === 0) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            // FORCED MIGRATION: Ensuring PieceJob uses TowMech bucket despite any environment variables
            const bucketName = 'towmech-dc8c4.firebasestorage.app';

            console.log(`[FIREBASE_INIT] FORCED STORAGE MIGRATION`);
            console.log(`[FIREBASE_INIT] Project: ${serviceAccount.project_id}`);
            console.log(`[FIREBASE_INIT] Bucket: ${bucketName}`);

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                storageBucket: bucketName
            });
            console.log('✅ Firebase Admin Initialized');
        }
    } catch (error: any) {
        console.error('❌ Firebase Initialization Failed:', error.message);
    }
};

export default initializeFirebase;
