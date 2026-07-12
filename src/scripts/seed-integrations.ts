import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Integration from '../models/Integration';
import PaymentProvider from '../models/PaymentProvider';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

async function seed() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB for seeding integrations...');

        // 1. Seed Google Maps
        await Integration.findOneAndUpdate(
            { type: 'GOOGLE_MAPS' },
            {
                name: 'Google Maps Platform',
                config: {
                    MAPS_API_KEY: 'AIzaSyA6ejydkakIIGLWO9YLCPID7zCiS0VoU3w',
                    PLACES_API_KEY: 'AIzaSyA6ejydkakIIGLWO9YLCPID7zCiS0VoU3w'
                },
                isActive: true
            },
            { upsert: true }
        );

        // 2. Seed Firebase
        await Integration.findOneAndUpdate(
            { type: 'FIREBASE' },
            {
                name: 'Firebase Cloud',
                config: {
                    PROJECT_ID: 'piecejob-b596e',
                    STORAGE_BUCKET: 'piecejob-b596e.firebasestorage.app',
                    MESSAGING_SENDER_ID: '288646031149'
                },
                isActive: true
            },
            { upsert: true }
        );

        // 3. Seed Payment Providers (Updated for per-country isolation)
        const providers = [
            {
                name: 'PayFast (ZA)',
                code: 'payfast',
                countryCode: 'ZA',
                currency: 'ZAR',
                priority: 1,
                environment: 'sandbox',
                isActive: true
            },
            {
                name: 'Paystack (ZA)',
                code: 'paystack',
                countryCode: 'ZA',
                currency: 'ZAR',
                priority: 2,
                environment: 'sandbox',
                isActive: true,
                secretKey: 'sk_test_PLACEHOLDER', // USER MUST REPLACE IN DASHBOARD
                publicKey: 'pk_test_PLACEHOLDER', // USER MUST REPLACE IN DASHBOARD
                webhookSecret: 'pj_whsec_8FvK29LmQx7PzR4NsY8aWdJ2HcE91MrTb6XpQ5LzUv7',
                callbackUrl: process.env.PAYSTACK_CALLBACK_URL || 'https://piecejob.co/payments/callback'
            },
            {
                name: 'Paystack (NG)',
                code: 'paystack',
                countryCode: 'NG',
                currency: 'NGN',
                priority: 1,
                environment: 'sandbox',
                isActive: true
            },
            {
                name: 'Stripe (US)',
                code: 'stripe',
                countryCode: 'US',
                currency: 'USD',
                priority: 1,
                environment: 'sandbox',
                isActive: true
            }
        ];

        for (const p of providers) {
            await PaymentProvider.findOneAndUpdate(
                { code: p.code, countryCode: p.countryCode },
                p,
                { upsert: true }
            );
        }

        console.log('Seeding complete!');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

seed();
