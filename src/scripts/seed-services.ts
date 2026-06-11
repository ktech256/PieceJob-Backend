import mongoose from 'mongoose';
import Service, { ServiceCategory, GenderRule, VerificationLevel } from '../models/Service';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const services = [
  {
    code: 'HDS-01',
    name: 'House Cleaning',
    category: ServiceCategory.HDS,
    genderRule: GenderRule.BOTH,
    verificationLevel: VerificationLevel.STANDARD,
    equipmentRequired: ['Basic Kit'],
    isActive: true,
    countryCode: 'GLOBAL'
  },
  {
    code: 'HDS-04',
    name: 'Laundry & Ironing',
    category: ServiceCategory.HDS,
    genderRule: GenderRule.WOMEN_ONLY,
    verificationLevel: VerificationLevel.STANDARD,
    equipmentRequired: ['Mobile Iron'],
    isActive: true,
    countryCode: 'GLOBAL'
  },
  {
    code: 'HDS-05',
    name: 'Yard Cleaning',
    category: ServiceCategory.HDS,
    genderRule: GenderRule.MEN_ONLY,
    verificationLevel: VerificationLevel.STANDARD,
    equipmentRequired: ['Rake', 'Broom'],
    isActive: true,
    countryCode: 'GLOBAL'
  },
  {
    code: 'HDS-08',
    name: 'Pool Cleaning',
    category: ServiceCategory.HDS,
    genderRule: GenderRule.MEN_ONLY,
    verificationLevel: VerificationLevel.PROFESSIONAL,
    equipmentRequired: ['Test Kit', 'Vac'],
    isActive: true,
    countryCode: 'GLOBAL'
  },
  {
    code: 'CSS-11',
    name: 'Babysitting',
    category: ServiceCategory.CSS,
    genderRule: GenderRule.WOMEN_ONLY,
    verificationLevel: VerificationLevel.HIGH_VETTING,
    equipmentRequired: [],
    isActive: true,
    countryCode: 'GLOBAL'
  },
  {
    code: 'HMS-18',
    name: 'Minor Electrical',
    category: ServiceCategory.HMS,
    genderRule: GenderRule.BOTH,
    verificationLevel: VerificationLevel.TRADE,
    equipmentRequired: ['Multimeter'],
    isActive: true,
    countryCode: 'GLOBAL'
  }
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    for (const s of services) {
      await Service.findOneAndUpdate({ code: s.code, countryCode: s.countryCode }, s, { upsert: true });
    }

    console.log('Services seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();
