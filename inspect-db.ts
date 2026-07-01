import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Country from './src/models/Country';
import SystemSettings from './src/models/SystemSettings';
import Wallet from './src/models/Wallet';

dotenv.config();

async function inspect() {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';
    await mongoose.connect(MONGO_URI);

    console.log("--- WORKSPACE DOCUMENT (SOUTH AFRICA) ---");
    const zaCountry = await Country.findOne({ code: 'ZA' });
    console.log(JSON.stringify(zaCountry, null, 2));

    console.log("\n--- SYSTEM SETTINGS (ZA) ---");
    const zaSettings = await SystemSettings.findOne({ countryCode: 'ZA' });
    console.log(JSON.stringify(zaSettings, null, 2));

    console.log("\n--- SYSTEM SETTINGS (GLOBAL) ---");
    const globalSettings = await SystemSettings.findOne({ countryCode: 'GLOBAL' });
    console.log(JSON.stringify(globalSettings, null, 2));

    await mongoose.disconnect();
}

inspect();
