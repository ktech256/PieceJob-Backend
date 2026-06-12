import mongoose from 'mongoose';
import Service, { ServiceCategory, GenderRule, VerificationLevel } from '../models/Service';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const services = [
  // HDS - Home & Domestic Services (01-10)
  { code: 'HDS-01', name: 'House Cleaning', category: ServiceCategory.HDS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Basic Kit'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-02', name: 'Deep Cleaning', category: ServiceCategory.HDS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Vacuum', 'Steam Cleaner'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-03', name: 'Window Washing', category: ServiceCategory.HDS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Squeegee', 'Ladder'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-04', name: 'Laundry & Ironing', category: ServiceCategory.HDS, genderRule: GenderRule.WOMEN_ONLY, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Mobile Iron'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-05', name: 'Yard Cleaning', category: ServiceCategory.HDS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Rake', 'Broom'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-06', name: 'Oven Cleaning', category: ServiceCategory.HDS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Degreaser'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-07', name: 'Carpet Cleaning', category: ServiceCategory.HDS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Carpet Extractor'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-08', name: 'Pool Cleaning', category: ServiceCategory.HDS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Test Kit', 'Vac'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-09', name: 'Pest Control', category: ServiceCategory.HDS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Sprayer'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HDS-10', name: 'Gutter Cleaning', category: ServiceCategory.HDS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Ladder', 'Gloves'], isActive: true, countryCode: 'GLOBAL' },

  // CSS - Care & Support Services (11-17)
  { code: 'CSS-11', name: 'Babysitting', category: ServiceCategory.CSS, genderRule: GenderRule.WOMEN_ONLY, verificationLevel: VerificationLevel.HIGH_VETTING, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'CSS-12', name: 'Nanny Service', category: ServiceCategory.CSS, genderRule: GenderRule.WOMEN_ONLY, verificationLevel: VerificationLevel.HIGH_VETTING, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'CSS-13', name: 'Au Pair', category: ServiceCategory.CSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.HIGH_VETTING, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'CSS-14', name: 'After School Care', category: ServiceCategory.CSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.HIGH_VETTING, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'CSS-15', name: 'Elderly Care', category: ServiceCategory.CSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.HIGH_VETTING, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'CSS-16', name: 'Disability Support', category: ServiceCategory.CSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.HIGH_VETTING, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'CSS-17', name: 'Pet Sitting', category: ServiceCategory.CSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },

  // HMS - Handyman Services (18-25)
  { code: 'HMS-18', name: 'Minor Electrical', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.TRADE, equipmentRequired: ['Multimeter'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HMS-19', name: 'Light Fitting Installation', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.TRADE, equipmentRequired: ['Screwdrivers', 'Pliers'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HMS-20', name: 'Plumbing Repair', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.TRADE, equipmentRequired: ['Wrench Kit'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HMS-21', name: 'Tap/Faucet Replacement', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.TRADE, equipmentRequired: ['Pipe Wrench'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HMS-22', name: 'Furniture Assembly', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Allen Keys', 'Hammer'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HMS-23', name: 'Picture Hanging', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Level', 'Drill'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HMS-24', name: 'Shelf Mounting', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Drill', 'Anchors'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'HMS-25', name: 'Door Lock Repair', category: ServiceCategory.HMS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Chisels', 'Drivers'], isActive: true, countryCode: 'GLOBAL' },

  // OPS - Outdoor Services (26-30)
  { code: 'OPS-26', name: 'Grass Cutting', category: ServiceCategory.OPS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Lawnmower'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'OPS-27', name: 'Hedge Trimming', category: ServiceCategory.OPS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Trimmer'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'OPS-28', name: 'Tree Trimming', category: ServiceCategory.OPS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Chainsaw'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'OPS-29', name: 'Garden Refuse Removal', category: ServiceCategory.OPS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Trailer/Truck'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'OPS-30', name: 'Pressure Cleaning Driveway', category: ServiceCategory.OPS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['High Pressure Washer'], isActive: true, countryCode: 'GLOBAL' },

  // LLS - Lifestyle Services (31-38)
  { code: 'LLS-31', name: 'Mobile Car Wash', category: ServiceCategory.LLS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Pressure Wash'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'LLS-32', name: 'Car Detailing', category: ServiceCategory.LLS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Polisher', 'Vac'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'LLS-33', name: 'Personal Training', category: ServiceCategory.LLS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'LLS-34', name: 'Yoga Instructor', category: ServiceCategory.LLS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'LLS-35', name: 'Personal Shopper', category: ServiceCategory.LLS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: [], isActive: true, countryCode: 'GLOBAL' },
  { code: 'LLS-36', name: 'Grocery Delivery', category: ServiceCategory.LLS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Vehicle'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'LLS-37', name: 'Mobile Barber', category: ServiceCategory.LLS, genderRule: GenderRule.MEN_ONLY, verificationLevel: VerificationLevel.TRADE, equipmentRequired: ['Barber Kit'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'LLS-38', name: 'Mobile Hair Stylist', category: ServiceCategory.LLS, genderRule: GenderRule.WOMEN_ONLY, verificationLevel: VerificationLevel.TRADE, equipmentRequired: ['Styling Kit'], isActive: true, countryCode: 'GLOBAL' },

  // TSS - Technology Services (39-41)
  { code: 'TSS-39', name: 'TV Mounting', category: ServiceCategory.TSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.STANDARD, equipmentRequired: ['Drill', 'Level'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'TSS-40', name: 'Home Theatre Setup', category: ServiceCategory.TSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Cabling Tools'], isActive: true, countryCode: 'GLOBAL' },
  { code: 'TSS-41', name: 'WiFi Setup', category: ServiceCategory.TSS, genderRule: GenderRule.BOTH, verificationLevel: VerificationLevel.PROFESSIONAL, equipmentRequired: ['Laptop'], isActive: true, countryCode: 'GLOBAL' }
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    for (const s of services) {
      await Service.findOneAndUpdate({ code: s.code, countryCode: s.countryCode }, s, { upsert: true });
    }

    console.log(`Successfully seeded ${services.length} services`);
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();
