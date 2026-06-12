import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import Provider from '../models/Provider';
import Job from '../models/Job';
import Ledger from '../models/Ledger';
import Country from '../models/Country';
import ExchangeRate from '../models/ExchangeRate';
import AuditLog from '../models/AuditLog';
import FraudAlert from '../models/FraudAlert';
import SosIncident from '../models/SosIncident';
import Wallet from '../models/Wallet';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

async function forensicWipe() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('--- PIECEJOB FORENSIC DATA WIPE INITIATED ---');

        // Identify countries to preserve (user mentioned only Kenya)
        const countriesBefore = await Country.find();
        console.log('Countries currently in DB:', countriesBefore.map(c => `${c.name} (${c.code})`));

        const targetCountries = ['ZA', 'BW', 'NA']; // These are the SEEDED countries

        console.log(`Targeting seeded data for: ${targetCountries.join(', ')}`);

        // 1. Delete seeded jobs and financial records
        const jobDel = await Job.deleteMany({ countryCode: { $in: targetCountries } });
        const ledgerDel = await Ledger.deleteMany({ countryCode: { $in: targetCountries } });
        const walletDel = await Wallet.deleteMany({ countryCode: { $in: targetCountries } });
        console.log(`Cleaned: ${jobDel.deletedCount} Jobs, ${ledgerDel.deletedCount} Ledger entries, ${walletDel.deletedCount} Wallets.`);

        // 2. Delete seeded Users and Providers
        // To be safe, we look for users with the seeded email patterns
        const userDel = await User.deleteMany({
            $or: [
                { email: /example\.com$/ }, // Seeded users use @example.com
                { countryCode: { $in: targetCountries } }
            ],
            email: { $ne: 'admin@towmech.com' } // NEVER delete the super admin
        });

        // Providers are linked to users, we'll clean all and let real ones re-verify or filter by country
        const providerDel = await Provider.deleteMany({ countryCode: { $in: targetCountries } });
        console.log(`Cleaned: ${userDel.deletedCount} Users, ${providerDel.deletedCount} Providers.`);

        // 3. Delete incidents and logs
        await SosIncident.deleteMany({ countryCode: { $in: targetCountries } });
        await FraudAlert.deleteMany({ countryCode: { $in: targetCountries } });
        await AuditLog.deleteMany({ countryCode: { $in: targetCountries } });

        // 4. Remove seeded countries from Registry
        const countryDel = await Country.deleteMany({ code: { $in: targetCountries } });
        console.log(`Cleaned: ${countryDel.deletedCount} Countries.`);

        console.log('--- WIPE COMPLETE. SYSTEM RETURNED TO PRODUCTION BASELINE ---');

        const countriesAfter = await Country.find();
        console.log('Countries remaining in DB:', countriesAfter.map(c => `${c.name} (${c.code})`));

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Wipe failed:', error);
        process.exit(1);
    }
}

forensicWipe();
