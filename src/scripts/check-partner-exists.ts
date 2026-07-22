import mongoose from 'mongoose';
import AffiliatePartner from '../models/AffiliatePartner';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const emailToCheck = process.argv[2];

if (!emailToCheck) {
  console.error('Usage: ts-node check-partner-exists.ts <email>');
  process.exit(1);
}

const check = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const partner = await AffiliatePartner.findOne({ email: emailToCheck.toLowerCase() });
    if (!partner) {
      console.log(`Partner with email ${emailToCheck} NOT found.`);
    } else {
      console.log(`Partner found: ${partner.name} | Status: ${partner.status} | Country: ${partner.countryCode}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Check failed:', error);
    process.exit(1);
  }
};

check();
