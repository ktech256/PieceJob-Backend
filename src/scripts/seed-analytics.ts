import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import Provider, { VerificationStatus, ProviderTier } from '../models/Provider';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
import Country from '../models/Country';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const seedAnalytics = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const countryCodes = ['ZA', 'BW', 'NA'];
    const services = ['HDS', 'CSS', 'HMS', 'OPS', 'LLS', 'TSS'];

    for (const code of countryCodes) {
      console.log(`Seeding analytics for ${code}...`);

      const country = await Country.findOne({ code });
      const currency = country?.currency || 'USD';

      // Create some Users
      const customers = [];
      for (let i = 0; i < 10; i++) {
        const email = `customer_${code}_${i}@example.com`;
        const user = await User.findOneAndUpdate(
            { email },
            {
                firstName: `Customer_${code}_${i}`,
                lastName: 'Test',
                phoneNumber: `+${code === 'ZA' ? '27' : code === 'BW' ? '267' : '264'}1234567${i}`,
                passwordHash: 'hashed',
                role: UserRole.CUSTOMER,
                countryCode: code,
                isVerified: true,
                $setOnInsert: { referralCode: `CUST-${code}-${i}-${uuidv4().slice(0, 4).toUpperCase()}` }
            },
            { upsert: true, new: true }
        );
        customers.push(user);
      }

      // Create some Providers
      const providers = [];
      for (let i = 0; i < 5; i++) {
        const email = `provider_${code}_${i}@example.com`;
        const user = await User.findOneAndUpdate(
            { email },
            {
                firstName: `Provider_${code}_${i}`,
                lastName: 'Test',
                phoneNumber: `+${code === 'ZA' ? '27' : code === 'BW' ? '267' : '264'}9876543${i}`,
                passwordHash: 'hashed',
                role: UserRole.PROVIDER,
                countryCode: code,
                isVerified: true,
                $setOnInsert: { referralCode: `PROV-${code}-${i}-${uuidv4().slice(0, 4).toUpperCase()}` }
            },
            { upsert: true, new: true }
        );

        const provider = await Provider.findOneAndUpdate(
            { userId: user._id },
            {
                gender: i % 2 === 0 ? 'M' : 'W',
                dob: new Date(1990, 1, 1),
                nationalityType: 'Citizen',
                idOrPassportNumber: `ID${i}${code}`,
                servicesOffered: [services[i % services.length]],
                verificationStatus: VerificationStatus.APPROVED,
                tier: ProviderTier.GOLD,
                isOnline: true,
                location: {
                    type: 'Point',
                    coordinates: [28.0473 + (Math.random() * 0.1), -26.2041 + (Math.random() * 0.1)]
                },
                countryCode: code
            },
            { upsert: true, new: true }
        );
        providers.push({ user, provider });
      }

      // Create some Jobs (Historical and Active)
      // Since jobs don't have a unique natural key in this script, we'll clear them first for this seed run
      await Job.deleteMany({ countryCode: code });
      await Ledger.deleteMany({ countryCode: code });

      for (let i = 0; i < 20; i++) {
        const customer = customers[i % customers.length];
        const { provider, user: providerUser } = providers[i % providers.length];
        const status = i < 5 ? JobStatus.COMPLETED : i < 8 ? JobStatus.CANCELLED : JobStatus.STARTED;

        const createdAt = new Date();
        createdAt.setDate(createdAt.getDate() - (i % 30)); // Spread over 30 days

        const job = new Job({
          customerId: customer._id,
          providerId: providerUser._id,
          serviceCode: services[i % services.length],
          status,
          countryCode: code,
          location: {
            type: 'Point',
            coordinates: [28.0473 + (Math.random() * 0.05), -26.2041 + (Math.random() * 0.05)]
          },
          bookingFee: 50,
          serviceFee: 200,
          paymentStatus: status === JobStatus.COMPLETED ? 'PAID' : 'PENDING',
          createdAt,
          acceptedAt: new Date(createdAt.getTime() + 1000 * 60 * 5), // 5 mins later
          startedAt: new Date(createdAt.getTime() + 1000 * 60 * 30), // 30 mins later
          completedAt: status === JobStatus.COMPLETED ? new Date(createdAt.getTime() + 1000 * 60 * 90) : undefined
        });
        await job.save();

        if (status === JobStatus.COMPLETED) {
            const totalAmount = (job.serviceFee || 0) + job.bookingFee;
            // Seed Ledger entries for financials
            await new Ledger({
                transactionId: uuidv4(),
                jobId: job._id,
                toUserId: providerUser._id,
                amount: totalAmount,
                currency: currency,
                countryCode: code,
                type: TransactionType.SERVICE_FEE,
                status: 'COMPLETED'
            }).save();

            await new Ledger({
                transactionId: uuidv4(),
                jobId: job._id,
                fromUserId: providerUser._id,
                amount: totalAmount * 0.15, // 15% commission
                currency: currency,
                countryCode: code,
                type: TransactionType.COMMISSION,
                status: 'COMPLETED'
            }).save();
        }
      }
    }

    console.log('Analytics Seeding Complete');
    await mongoose.disconnect();
  } catch (error) {
    console.error('Seed error:', error);
  }
};

seedAnalytics();
