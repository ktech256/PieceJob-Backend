import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import EmailLog from '../models/EmailLog';
import AffiliatePartner from '../models/AffiliatePartner';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const check = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const template = await NotificationTemplate.findOne({ templateCode: 'PARTNER_PASSWORD_RESET' });
    if (!template) {
      console.error('CRITICAL: Template PARTNER_PASSWORD_RESET not found in database.');
    } else {
      console.log('Template PARTNER_PASSWORD_RESET exists and is ' + (template.active ? 'ACTIVE' : 'INACTIVE'));
    }

    const logs = await EmailLog.find({ templateCode: 'PARTNER_PASSWORD_RESET' }).sort({ createdAt: -1 }).limit(5);
    if (logs.length === 0) {
      console.log('No email logs found for PARTNER_PASSWORD_RESET.');
    } else {
      console.log('Recent Email Logs:');
      logs.forEach(l => {
        console.log(`- To: ${l.recipient} | Status: ${l.status} | Error: ${l.errorMessage || 'None'} | Date: ${l.createdAt}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Check failed:', error);
    process.exit(1);
  }
};

check();
