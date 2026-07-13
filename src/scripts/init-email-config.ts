import mongoose from 'mongoose';
import Country from '../models/Country';
import SystemSettings from '../models/SystemSettings';
import EmailConfig from '../models/EmailConfig';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const init = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const countries = await Country.find({ isActive: true });

    for (const country of countries) {
      const settings = await SystemSettings.findOne({ countryCode: country.code });

      const config = await EmailConfig.findOneAndUpdate(
        { countryCode: country.code },
        {
          $setOnInsert: {
            enabled: true,
            fromName: `PieceJob ${country.name}`,
            fromEmail: `support.${country.code.toLowerCase()}@piecejob.co`,
            smtpProvider: 'SMTP',
            branding: {
              companyName: `PieceJob ${country.name}`,
              supportEmail: settings?.supportEmail || `support.${country.code.toLowerCase()}@piecejob.co`,
              supportPhone: settings?.supportPhone || ''
            }
          }
        },
        { upsert: true, new: true }
      );
      console.log(`Initialized Email Config for ${country.code}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Init failed:', error);
    process.exit(1);
  }
};

init();
