import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Job, { JobStatus } from '../models/Job';
import User, { UserRole } from '../models/User';
import Provider, { ProviderTier } from '../models/Provider';
import Service, { VerificationLevel } from '../models/Service';
import * as jobService from '../services/job.service';
import * as presenceService from '../services/provider-presence.service';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

async function runTests() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('--- MISSION CRITICAL SYSTEM AUDIT INITIATED ---');

        const customer = await User.findOne({ role: UserRole.CUSTOMER });
        const providers = await User.find({ role: UserRole.PROVIDER }).limit(2);

        if (!customer || providers.length < 2) {
            console.error('Test blocked: Missing seed users.');
            process.exit(1);
        }

        const providerA = providers[0];
        const providerB = providers[1];

        // Ensure providers have valid ELITE approved profiles for Wave 1
        await Provider.findOneAndUpdate(
            { userId: providerA._id },
            {
                verificationStatus: 'APPROVED',
                verificationLevel: VerificationLevel.HIGH_VETTING,
                tier: ProviderTier.ELITE,
                isOnline: true,
                countryCode: 'ZA',
                servicesOffered: ['HDS-01'],
                location: { type: 'Point', coordinates: [28.0473, -26.2041] }
            },
            { upsert: true, new: true }
        );
        await Provider.findOneAndUpdate(
            { userId: providerB._id },
            {
                verificationStatus: 'APPROVED',
                verificationLevel: VerificationLevel.HIGH_VETTING,
                tier: ProviderTier.ELITE,
                isOnline: true,
                countryCode: 'ZA',
                servicesOffered: ['HDS-01'],
                location: { type: 'Point', coordinates: [28.0473, -26.2041] }
            },
            { upsert: true, new: true }
        );

        console.log('\n--- SECTION 1: BROADCAST WAVE SYSTEM ---');
        const job = new Job({
            customerId: customer._id,
            serviceCode: 'HDS-01',
            countryCode: 'ZA',
            location: { type: 'Point', coordinates: [28.0473, -26.2041] },
            bookingFee: 50,
            status: JobStatus.BROADCASTED,
            paymentStatus: 'PAID',
            providerId: null
        });
        await job.save();

        const providersMatched = await jobService.findEligibleProviders(job, 1);
        console.log(`Eligible Providers Found (Wave 1): ${providersMatched.length}`);

        console.log('\n--- SECTION 2: SINGLE ACCEPTANCE ---');
        try {
            const accepted = await jobService.acceptJob(job._id.toString(), providerA._id.toString());
            if (!accepted) throw new Error('accepted result is undefined');
            console.log('Single Acceptance Success. Status:', accepted.status);
        } catch (e: any) {
            console.log('Single Acceptance Failed:', e.message);
        }

        // Reset job for race condition test
        await Job.findByIdAndUpdate(job._id, { status: JobStatus.BROADCASTED, providerId: null });

        console.log('\n--- SECTION 3: ATOMIC ASSIGNMENT LOCKING (RACE) ---');
        console.log('Simulating simultaneous acceptance...');
        const [resA, resB] = await Promise.allSettled([
            jobService.acceptJob(job._id.toString(), providerA._id.toString()),
            jobService.acceptJob(job._id.toString(), providerB._id.toString())
        ]);

        const winners = [resA, resB].filter(r => r.status === 'fulfilled');
        const finalJob = await Job.findById(job._id);
        console.log(`Winners: ${winners.length}`);
        console.log(`Assigned Provider: ${finalJob?.providerId}`);

        console.log('\n--- SECTION 4, 5 & 6: TRACKING & ARRIVAL ---');
        const activeProvId = finalJob?.providerId?.toString();
        if (activeProvId) {
            console.log('Simulating movement...');
            await presenceService.handleHeartbeat(activeProvId, [28.0473, -26.2042]);
            const jobArrived = await Job.findById(job._id);
            console.log(`Status after Arrival Movement: ${jobArrived?.status}`);
        }

        console.log('\n--- SECTION 9: END-TO-END FLOW SUMMARY ---');
        console.log(`1. Job Discovery: ${providersMatched.length > 0 ? '✅' : '❌'}`);
        console.log(`2. Atomic Locking: ${winners.length === 1 ? '✅' : '❌'}`);
        console.log(`3. Arrival Trigger: ${(await Job.findById(job._id))?.status === JobStatus.ARRIVED ? '✅' : '❌'}`);

        await job.deleteOne();
        await mongoose.disconnect();
        console.log('\n--- VERIFICATION AUDIT COMPLETE ---');
        process.exit(0);
    } catch (error) {
        console.error('Audit failed:', error);
        process.exit(1);
    }
}

runTests();
