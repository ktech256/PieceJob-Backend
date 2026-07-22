import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import EmailConfig from '../models/EmailConfig';
import AffiliatePartner from '../models/AffiliatePartner';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const repair = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // 1. Ensure PARTNER_PASSWORD_RESET template exists
    const templateCode = 'PARTNER_PASSWORD_RESET';
    const existingTemplate = await NotificationTemplate.findOne({ templateCode, channel: 'EMAIL' });

    if (!existingTemplate) {
      console.log(`Seeding missing template: ${templateCode}`);
      await NotificationTemplate.create({
        templateCode,
        channel: 'EMAIL',
        category: 'ACCOUNT',
        description: 'Password reset link for Affiliate Partners.',
        trigger: 'Partner Forgot Password',
        recipient: 'Partner',
        priority: 'HIGH',
        language: 'EN',
        subject: 'Reset Your PieceJob Partner Password',
        body: '<h1>Password Recovery</h1><p>Hi {{name}},</p><p>A password reset has been initiated for your PieceJob Partner Protocol account. To establish a new access pass, please click the secure link below:</p><div style="text-align: center; margin: 40px 0;"><a href="{{resetLink}}" style="display: inline-block; padding: 20px 40px; background-color: #D32F2F; color: #ffffff; text-decoration: none; border-radius: 16px; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em;">Reset Password</a></div><p><b>This link will expire in {{expiry}}.</b></p><p>If you did not initiate this recovery signal, please ignore this transmission and ensure your security sectors are secure.</p>',
        plainTextBody: 'Hi {{name}}, reset your PieceJob Partner password here: {{resetLink}}. Expires in {{expiry}}.',
        placeholders: ['name', 'resetLink', 'expiry'],
        countryCode: 'GLOBAL'
      });
      console.log('Template seeded successfully.');
    } else {
      console.log(`Template ${templateCode} already exists.`);
    }

    // 2. Ensure GLOBAL EmailConfig exists and has ACCOUNT category enabled
    const config = await EmailConfig.findOne({ countryCode: 'GLOBAL' });
    if (!config) {
      console.log('Creating missing GLOBAL EmailConfig...');
      await EmailConfig.create({
        countryCode: 'GLOBAL',
        enabled: true,
        fromName: 'PieceJob Global',
        fromEmail: 'no-reply@piecejob.co',
        smtpProvider: 'SMTP',
        enabledCategories: {
          ACCOUNT: true,
          SECURITY: true
        }
      });
      console.log('GLOBAL EmailConfig created.');
    } else {
      if (!config.enabledCategories.ACCOUNT) {
        config.enabledCategories.ACCOUNT = true;
        await config.save();
        console.log('Enabled ACCOUNT category in GLOBAL EmailConfig.');
      }
    }

    // 3. Diagnostic: List all Partners
    const partners = await AffiliatePartner.find({}, 'name email status');
    console.log(`Total Partners in DB: ${partners.length}`);
    partners.forEach(p => {
      console.log(`- ${p.name} (${p.email}) [${p.status}]`);
    });

    console.log('\nRepair and Verification Complete.');
    process.exit(0);
  } catch (error) {
    console.error('Repair failed:', error);
    process.exit(1);
  }
};

repair();
