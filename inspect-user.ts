import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User';

dotenv.config();

async function inspect() {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';
    await mongoose.connect(MONGO_URI);

    console.log("--- SAMPLE USER ---");
    const user = await User.findOne();
    if (user) {
        console.log({
            id: user._id,
            firstName: user.firstName,
            countryCode: user.countryCode,
            role: user.role
        });
    } else {
        console.log("No user found");
    }

    await mongoose.disconnect();
}

inspect();
