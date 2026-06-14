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
            const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'piecejob-b596e.appspot.com';

            console.log(`[FIREBASE_INIT] Initializing for project: ${serviceAccount.project_id}`);
            console.log(`[FIREBASE_INIT] Using Storage Bucket: ${bucketName}`);

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
