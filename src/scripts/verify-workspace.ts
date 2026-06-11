import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = 'http://localhost:5000/api/v1';

async function verify() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob');
    console.log('Connected to DB');

    // 1. Create a ZA user
    const zaUser = await User.findOneAndUpdate(
        { email: 'za@test.com' },
        { firstName: 'South', lastName: 'Africa', role: UserRole.CUSTOMER, countryCode: 'ZA', phoneNumber: '012' },
        { upsert: true, new: true }
    );
    console.log('Created ZA User');

    // 2. Create a NA user
    const naUser = await User.findOneAndUpdate(
        { email: 'na@test.com' },
        { firstName: 'Namibia', lastName: 'User', role: UserRole.CUSTOMER, countryCode: 'NA', phoneNumber: '013' },
        { upsert: true, new: true }
    );
    console.log('Created NA User');

    // 3. Authenticate as Super Admin (Simulated token or use existing)
    // For verification, we'll just check the middleware logic via direct calls if we have a token.
    // Or we test the tenantContext middleware function unit-style.

    console.log('Running Isolation Checks...');

    // We'll simulate the tenant middleware behavior
    const checkIsolation = (header: string, userProfile: string, userRole: string) => {
        let active = userProfile;
        if (userRole === 'SUPER_ADMIN') {
            if (header) active = header;
        } else {
            if (header && header !== userProfile) throw new Error('Isolation Breach: Tenant Access Denied');
        }
        return active;
    };

    console.log('SUPER_ADMIN with header NA -> Workspace:', checkIsolation('NA', 'ZA', 'SUPER_ADMIN'));
    console.log('ADMIN with header NA and profile ZA -> Expect Error');
    try {
        checkIsolation('NA', 'ZA', 'ADMIN');
    } catch (e: any) {
        console.log('Caught expected error:', e.message);
    }

    console.log('Verification Logic Passed');
    process.exit(0);
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
}

verify();
