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
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'piecejob-b596e.firebasestorage.app'
            });
            console.log('✅ Firebase Admin Initialized with Storage');
        }
    } catch (error: any) {
        console.error('❌ Firebase Initialization Failed:', error.message);
    }
};

export default initializeFirebase;
