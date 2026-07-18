import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const templates = [
    {
        templateCode: 'REFUND_APPROVED',
        channel: 'PUSH',
        title: 'Refund Approved',
        body: 'Great news! Your refund for job #{{jobId}} has been approved and credited to your wallet.',
        placeholders: ['jobId'],
        countryCode: 'GLOBAL'
    },
    {
        templateCode: 'REFUND_DECLINED',
        channel: 'PUSH',
        title: 'Refund Update',
        body: 'Your refund request for job #{{jobId}} was declined after admin review.',
        placeholders: ['jobId'],
        countryCode: 'GLOBAL'
    },
    {
        templateCode: 'JOB_REASSIGNED_CUSTOMER',
        channel: 'PUSH',
        title: 'Finding New Provider',
        body: 'We are re-assigning your job #{{jobId}} to another professional to ensure timely service.',
        placeholders: ['jobId'],
        countryCode: 'GLOBAL'
    },
    {
        templateCode: 'PROVIDER_PENALTY_NOTICE',
        channel: 'PUSH',
        title: 'Penalty Notice',
        body: 'A financial penalty of {{amount}} {{currency}} has been applied to your account due to a cancellation dispute for job #{{jobId}}.',
        placeholders: ['amount', 'currency', 'jobId'],
        countryCode: 'GLOBAL'
    },
    {
        templateCode: 'TRAVEL_REMINDER',
        channel: 'PUSH',
        title: 'Movement Alert',
        body: '{{message}}',
        placeholders: ['message'],
        countryCode: 'GLOBAL'
    }
];

const seed = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        for (const t of templates) {
            await NotificationTemplate.findOneAndUpdate(
                { templateCode: t.templateCode, channel: t.channel, countryCode: t.countryCode },
                { $set: t },
                { upsert: true }
            );
            console.log(`Seeded template: ${t.templateCode}`);
        }

        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
};

seed();
