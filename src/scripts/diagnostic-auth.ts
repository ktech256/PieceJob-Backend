import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import EmailConfig from '../models/EmailConfig';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const diagnostic = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const templateCode = 'PARTNER_PASSWORD_RESET';
    const template = await NotificationTemplate.findOne({ templateCode, channel: 'EMAIL' });

    if (!template) {
      console.error(`CRITICAL: Template ${templateCode} NOT found in database.`);
    } else {
      console.log(`SUCCESS: Template ${templateCode} found.`);
      console.log('Active:', template.active);
      console.log('Placeholders:', template.placeholders);
      console.log('Subject:', template.subject);
    }

    const configs = await EmailConfig.find();
    console.log(`Found ${configs.length} Email Configurations:`);
    configs.forEach(c => {
      console.log(`- Country: ${c.countryCode} | Enabled: ${c.enabled} | SMTP Provider: ${c.smtpProvider}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Diagnostic failed:', error);
    process.exit(1);
  }
};

diagnostic();
