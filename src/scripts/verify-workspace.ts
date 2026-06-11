import mongoose from 'mongoose';
import Country from '../models/Country';
import User from '../models/User';
import Provider from '../models/Provider';
import Job from '../models/Job';
import Ledger from '../models/Ledger';
import ExchangeRate from '../models/ExchangeRate';
import SystemSettings from '../models/SystemSettings';
import dotenv from 'dotenv';

dotenv.config();

const verify = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob');
        console.log('--- PIECEJOB WORKSPACE AUDIT ---');

        const report = {
            countries: await Country.countDocuments(),
            users: await User.countDocuments(),
            providers: await Provider.countDocuments(),
            jobs: await Job.countDocuments(),
            ledgerEntries: await Ledger.countDocuments(),
            exchangeRates: await ExchangeRate.countDocuments(),
            settings: await SystemSettings.countDocuments()
        };

        console.table(report);

        if (report.countries === 0) {
            console.error('❌ CRITICAL: No countries found. Run "npm run seed:countries"');
        } else {
            console.log('✅ Countries verified.');
        }

        if (report.exchangeRates === 0) {
            console.error('❌ CRITICAL: No exchange rates found. Financial analytics will fail.');
        } else {
            console.log('✅ Exchange rates verified.');
        }

        if (report.settings === 0) {
            console.warn('⚠️ WARNING: No system settings found. Using global defaults.');
        }

        await mongoose.disconnect();
        console.log('Audit Complete.');
    } catch (e) {
        console.error('Audit Failed:', e);
    }
};

verify();
