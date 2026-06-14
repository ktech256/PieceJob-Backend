import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const initializeFirebase = () => {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not found in environment variables.');
        return;
    }

    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        // FORCED MIGRATION: Ensuring PieceJob uses TowMech bucket despite any environment variables
        const bucketName = 'towmech-dc8c4.firebasestorage.app';

        // FORCE RESET: Ensure we use the TowMech bucket even if another module initialized first
        if (admin.apps.length > 0) {
            console.log(`[FIREBASE_INIT] Re-initializing Firebase to force bucket: ${bucketName}`);
            Promise.all(admin.apps.map(app => app?.delete())).then(() => {
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                    storageBucket: bucketName
                });
            });
        } else {
            console.log(`[FIREBASE_INIT] Project: ${serviceAccount.project_id}, Bucket: ${bucketName}`);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                storageBucket: bucketName
            });
        }
        console.log('✅ Firebase Admin Initialized (TowMech Bucket Forced)');
    } catch (error: any) {
        console.error('❌ Firebase Initialization Failed:', error.message);
    }
};

export default initializeFirebase;
