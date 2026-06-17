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

        // 3. Seed Payment Providers
        const providers = [
            {
                name: 'PayFast',
                code: 'payfast',
                countries: ['ZA'],
                currency: ['ZAR'],
                priority: 1,
                environment: 'sandbox',
                isActive: true
            },
            {
                name: 'Paystack',
                code: 'paystack',
                countries: ['NG', 'KE', 'ZA'],
                currency: ['NGN', 'KES', 'ZAR'],
                priority: 2,
                environment: 'sandbox',
                isActive: true
            },
            {
                name: 'Stripe',
                code: 'stripe',
                countries: ['US', 'GB', 'EU'],
                currency: ['USD', 'GBP', 'EUR'],
                priority: 3,
                environment: 'sandbox',
                isActive: true
            }
        ];

        for (const p of providers) {
            await PaymentProvider.findOneAndUpdate(
                { code: p.code },
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
