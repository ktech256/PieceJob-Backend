import mongoose from 'mongoose';
import Provider from '../models/Provider';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const init = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const result = await Provider.updateMany(
            { 'performance.reliabilityScore': { $exists: false } },
            {
                $set: {
                    'performance.reliabilityScore': 100,
                    'performance.cancellationScore': 0,
                    'performance.acceptanceScore': 100,
                    'performance.onTimeResponseScore': 100
                }
            }
        );

        console.log(`Successfully initialized reliability scores for ${result.modifiedCount} providers.`);
        process.exit(0);
    } catch (error) {
        console.error('Initialization failed:', error);
        process.exit(1);
    }
};

init();
