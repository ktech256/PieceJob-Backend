import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User, { UserRole } from '../models/User';
import Provider, { ProviderTier, VerificationStatus } from '../models/Provider';
import Job, { JobStatus } from '../models/Job';
import PricingRule, { PricingLevel } from '../models/PricingRule';
import * as jobService from '../services/job.service';
import * as financialService from '../services/financial.service';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

async function runE2ESimulation() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('--- STARTING PIECEJOB E2E SIMULATION ---');

        // 1. Setup Mock Data
        const customer = await User.findOneAndUpdate(
            { email: 'customer@test.com' },
            { firstName: 'Test', lastName: 'Customer', role: UserRole.CUSTOMER, countryCode: 'ZA', phoneNumber: '0123456789', passwordHash: 'hash' },
            { upsert: true, new: true }
        );

        const providerUser = await User.findOneAndUpdate(
            { email: 'provider@test.com' },
            { firstName: 'Pro', lastName: 'Worker', role: UserRole.PROVIDER, countryCode: 'ZA', phoneNumber: '9876543210', passwordHash: 'hash' },
            { upsert: true, new: true }
        );

        const provider = await Provider.findOneAndUpdate(
            { userId: providerUser._id },
            {
                gender: 'M', dob: new Date(1990, 1, 1), nationalityType: 'Citizen',
                idOrPassportNumber: 'ID123', servicesOffered: ['HDS-01'],
                verificationStatus: VerificationStatus.APPROVED, tier: ProviderTier.ELITE,
                isOnline: true, location: { type: 'Point', coordinates: [28.0473, -26.2041] } // Johannesburg
            },
            { upsert: true, new: true }
        );

        await PricingRule.findOneAndUpdate(
            { serviceCode: 'HDS-01', countryCode: 'ZA', level: PricingLevel.SERVICE },
            { basePrice: 200, hourlyPrice: 100, surgeMultiplier: 1.0, priority: 10, isActive: true },
            { upsert: true }
        );

        console.log('Step 1: Mock data ready.');

        // 2. Customer Requests Job
        const job = new Job({
            customerId: customer._id,
            serviceCode: 'HDS-01',
            countryCode: 'ZA',
            location: { type: 'Point', coordinates: [28.0473, -26.2044] },
            bookingFee: 50,
            status: JobStatus.DRAFT
        });
        await job.save();
        console.log(`Step 2: Job created in DRAFT. JobID: ${job._id}`);

        // 3. Payment Success
        await financialService.handleBookingFee(job.id, customer._id.toString(), 50, 'ZAR', 'ZA');
        job.paymentStatus = 'PAID';
        job.status = JobStatus.BROADCASTED;
        await job.save();
        console.log('Step 3: Booking fee paid. Job status: BROADCASTED.');

        // 4. Provider Accepts
        const acceptedJob = await jobService.acceptJob(job.id, providerUser._id.toString());
        console.log(`Step 4: Provider accepted job. Job status: ${acceptedJob.status}`);

        // 5. Provider Arrives
        acceptedJob.status = JobStatus.ARRIVED;
        await acceptedJob.save();
        console.log('Step 5: Provider arrived at destination.');

        // 6. Job Started
        acceptedJob.status = JobStatus.STARTED;
        acceptedJob.startedAt = new Date();
        await acceptedJob.save();
        console.log('Step 6: Job STARTED.');

        // 7. Job Completed
        acceptedJob.status = JobStatus.COMPLETED;
        acceptedJob.completedAt = new Date();
        await acceptedJob.save();
        console.log('Step 7: Job COMPLETED.');

        // 8. Financial Settlement
        await financialService.completeJobFinancials(acceptedJob.id, providerUser._id.toString(), 300, 15, 'ZAR', 'ZA');
        console.log('Step 8: Financials calculated. Funds moved to Escrow.');

        console.log('--- E2E SIMULATION COMPLETED SUCCESSFULLY ---');
        process.exit(0);
    } catch (error) {
        console.error('Simulation failed:', error);
        process.exit(1);
    }
}

runE2ESimulation();
