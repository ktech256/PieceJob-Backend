import mongoose from 'mongoose';
import Job from '../models/Job';
import Wallet from '../models/Wallet';
import Provider from '../models/Provider';
import User from '../models/User';
import Country from '../models/Country';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const repair = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI as string);
        console.log('Connected to MongoDB for Workspace Repair');

        const activeCountry = await Country.findOne({ isActive: true }) || { code: 'ZA', currency: 'ZAR' };
        const defaultCountryCode = activeCountry.code;
        const defaultCurrency = activeCountry.currency;

        console.log(`Using Default Fallback: ${defaultCountryCode} (${defaultCurrency})`);

        // 1. Repair Wallets
        const walletsToRepair = await Wallet.find({
            $or: [
                { countryCode: { $exists: false } },
                { countryCode: null },
                { countryCode: "" },
                { currency: { $exists: false } },
                { currency: null }
            ]
        });

        console.log(`Found ${walletsToRepair.length} wallets needing repair.`);
        for (const wallet of walletsToRepair) {
            const user = await User.findById(wallet.userId);
            wallet.countryCode = user?.countryCode || defaultCountryCode;
            wallet.currency = wallet.currency || defaultCurrency;
            await wallet.save({ validateBeforeSave: false }); // Force save historical repair
        }

        // 2. Repair Providers
        const providersToRepair = await Provider.find({
            $or: [
                { countryCode: { $exists: false } },
                { countryCode: null },
                { countryCode: "" }
            ]
        });
        console.log(`Found ${providersToRepair.length} providers needing repair.`);
        for (const p of providersToRepair) {
            const user = await User.findById(p.userId);
            p.countryCode = user?.countryCode || defaultCountryCode;
            await p.save({ validateBeforeSave: false });
        }

        // 3. Repair Active Jobs
        const jobsToRepair = await Job.find({
            status: { $nin: ['COMPLETED', 'CANCELLED', 'CLOSED'] },
            $or: [
                { countryCode: { $exists: false } },
                { countryCode: null },
                { countryCode: "" }
            ]
        });
        console.log(`Found ${jobsToRepair.length} active jobs needing repair.`);
        for (const job of jobsToRepair) {
            const customer = await User.findById(job.customerId);
            job.countryCode = customer?.countryCode || defaultCountryCode;
            await job.save({ validateBeforeSave: false });
        }

        console.log('Workspace Repair Completed Successfully');
        process.exit(0);
    } catch (error) {
        console.error('Repair failed:', error);
        process.exit(1);
    }
};

repair();
