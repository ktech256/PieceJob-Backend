import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User, { UserRole } from '../models/User';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

async function createSuperAdmin() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const email = 'admin@towmech.com';
        const password = '12345';

        // Hash the password
        const passwordHash = await bcrypt.hash(password, 10);

        const adminData = {
            firstName: 'Super',
            lastName: 'Admin',
            email: email,
            phoneNumber: '+27000000000', // Default placeholder
            passwordHash: passwordHash,
            role: UserRole.SUPER_ADMIN,
            countryCode: 'ZA',
            isVerified: true,
            referralCode: 'SYSTEM_ADMIN'
        };

        const user = await User.findOneAndUpdate(
            { email: email },
            adminData,
            { upsert: true, new: true }
        );

        console.log(`✅ Super Admin created/updated: ${user.email}`);
        console.log('Role:', user.role);

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating Super Admin:', error);
        process.exit(1);
    }
}

createSuperAdmin();
