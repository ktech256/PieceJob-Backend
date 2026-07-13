import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import EmailConfig from '../models/EmailConfig';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const templates = [
  {
    templateCode: 'WELCOME_EMAIL',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Welcome to PieceJob, {{firstName}}!',
    body: '<h1>Welcome aboard!</h1><p>Hi {{firstName}}, thank you for joining PieceJob. We are excited to have you with us.</p><p>Start exploring services today!</p>',
    placeholders: ['firstName'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PASSWORD_RESET',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Reset Your PieceJob Password',
    body: '<p>Hi {{firstName}},</p><p>You requested a password reset. Click the link below to set a new password:</p><p><a href="{{resetLink}}">Reset Password</a></p><p>If you did not request this, please ignore this email.</p>',
    placeholders: ['firstName', 'resetLink'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'JOB_COMPLETED_RECEIPT',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Your PieceJob Receipt - {{serviceName}}',
    body: '<p>Hi {{firstName}},</p><p>Your job <b>{{serviceName}}</b> has been completed successfully.</p><p>Please find your official receipt attached to this email.</p><p>Thank you for using PieceJob!</p>',
    placeholders: ['firstName', 'serviceName', 'jobId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'JOB_REQUEST_CONFIRMATION',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Job Request Confirmed - {{serviceName}}',
    body: '<p>Hi {{firstName}},</p><p>We have received your request for <b>{{serviceName}}</b>.</p><p>We are currently looking for the best professional for you. We will notify you once a provider accepts your request.</p><p>Job ID: {{jobId}}</p>',
    placeholders: ['firstName', 'serviceName', 'jobId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PROVIDER_ASSIGNED',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Professional Assigned to Your Job!',
    body: '<p>Hi {{firstName}},</p><p>Good news! <b>{{providerName}}</b> has been assigned to your <b>{{serviceName}}</b> request.</p><p>You can now track their progress in the app.</p>',
    placeholders: ['firstName', 'serviceName', 'providerName', 'jobId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'JOB_CANCELLED',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Job Cancelled - {{serviceName}}',
    body: '<p>Hi {{firstName}},</p><p>The job <b>{{serviceName}}</b> has been cancelled by the {{cancelledBy}}.</p><p>Reason: {{reason}}</p>',
    placeholders: ['firstName', 'serviceName', 'cancelledBy', 'reason'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'LOGIN_ALERT',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Security Alert: New Login Detected',
    body: '<p>Hi {{firstName}},</p><p>We detected a new login to your PieceJob account.</p><ul><li>Time: {{time}}</li><li>IP Address: {{ip}}</li></ul><p>If this was not you, please secure your account immediately.</p>',
    placeholders: ['firstName', 'time', 'ip'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'REFERRAL_REWARD_EARNED',
    channel: 'EMAIL',
    category: 'REFERRAL',
    language: 'EN',
    subject: 'You Earned a Referral Reward!',
    body: '<p>Hi {{firstName}},</p><p>Congratulations! You have earned a reward of <b>{{currency}} {{amount}}</b> because {{referredName}} completed their qualifying job.</p><p>Your reward has been credited to your wallet.</p>',
    placeholders: ['firstName', 'referredName', 'amount', 'currency'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'WELCOME_PARTNER',
    channel: 'EMAIL',
    category: 'AFFILIATE',
    language: 'EN',
    subject: 'Welcome to the PieceJob Affiliate Program!',
    body: '<h1>Partner Onboarding Successful</h1><p>Hi {{name}},</p><p>Welcome to our affiliate network. Your unique referral code is: <b>{{referralCode}}</b></p><p>You can login to the Partner Portal using your email and temporary password: <b>{{password}}</b></p>',
    placeholders: ['name', 'referralCode', 'password'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PROVIDER_VERIFICATION_APPROVED',
    channel: 'EMAIL',
    category: 'PROVIDER',
    language: 'EN',
    subject: 'Verification Approved - Welcome Pro!',
    body: '<p>Hi {{firstName}},</p><p>Congratulations! Your professional verification has been approved. You can now start accepting jobs in the PieceJob network.</p><p>Go online now to start earning!</p>',
    placeholders: ['firstName'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PROVIDER_VERIFICATION_REJECTED',
    channel: 'EMAIL',
    category: 'PROVIDER',
    language: 'EN',
    subject: 'Verification Update - PieceJob',
    body: '<p>Hi {{firstName}},</p><p>We have reviewed your verification documents. Unfortunately, we could not approve your profile at this time.</p><p>Reason: {{reason}}</p><p>Please update your details and try again.</p>',
    placeholders: ['firstName', 'reason'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'WITHDRAWAL_COMPLETED',
    channel: 'EMAIL',
    category: 'WALLET',
    language: 'EN',
    subject: 'Withdrawal Completed Successfully',
    body: '<p>Hi {{firstName}},</p><p>Your withdrawal of <b>{{currency}} {{amount}}</b> has been processed successfully.</p><p>Bank Reference: {{reference}}</p>',
    placeholders: ['firstName', 'amount', 'currency', 'reference'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'WITHDRAWAL_FAILED',
    channel: 'EMAIL',
    category: 'WALLET',
    language: 'EN',
    subject: 'Withdrawal Request Failed',
    body: '<p>Hi {{firstName}},</p><p>We were unable to process your withdrawal of <b>{{currency}} {{amount}}</b>.</p><p>Reason: {{reason}}</p><p>The funds have been returned to your wallet.</p>',
    placeholders: ['firstName', 'amount', 'currency', 'reason'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'TAX_INVOICE',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Tax Invoice - {{invoiceNumber}}',
    body: '<p>Hi {{firstName}},</p><p>Please find your tax invoice for invoice number <b>{{invoiceNumber}}</b> attached to this email.</p><p>Amount: <b>{{amount}}</b></p>',
    placeholders: ['firstName', 'invoiceNumber', 'amount', 'invoiceId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'MONTHLY_STATEMENT',
    channel: 'EMAIL',
    category: 'PROVIDER',
    language: 'EN',
    subject: 'Your Monthly PieceJob Statement - {{period}}',
    body: '<p>Hi {{firstName}},</p><p>Your monthly statement for the period <b>{{period}}</b> is ready.</p><p>Please find the detailed report attached as a PDF.</p>',
    placeholders: ['firstName', 'period', 'statementId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'ADMIN_DAILY_SUMMARY',
    channel: 'EMAIL',
    category: 'ADMIN',
    language: 'EN',
    subject: 'PieceJob Daily Platform Summary - {{date}}',
    body: '<h2>Platform Performance Summary</h2><p>Date: {{date}}</p><ul><li>New Users: {{newUsers}}</li><li>New Jobs: {{newJobs}}</li><li>Completed Jobs: {{completedJobs}}</li><li>Total Revenue: {{totalRevenue}}</li></ul><p>Workspace: {{countryCode}}</p>',
    placeholders: ['date', 'newUsers', 'newJobs', 'completedJobs', 'totalRevenue', 'countryCode'],
    countryCode: 'GLOBAL'
  }
];

const seed = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    for (const t of templates) {
      await NotificationTemplate.findOneAndUpdate(
        { templateCode: t.templateCode, channel: t.channel, countryCode: t.countryCode },
        { $set: t },
        { upsert: true, new: true }
      );
      console.log(`Seeded template: ${t.templateCode}`);
    }

    // Seed Global Config
    await EmailConfig.findOneAndUpdate(
      { countryCode: 'GLOBAL' },
      {
        $set: {
          enabled: true,
          fromName: 'PieceJob Global',
          fromEmail: 'no-reply@piecejob.co',
          smtpProvider: 'SMTP',
          smtpHost: 'smtp.mailtrap.io', // Default for dev
          smtpPort: 587,
          smtpUser: 'user',
          smtpPass: 'pass',
          branding: {
            companyName: 'PieceJob Global',
            supportEmail: 'support@piecejob.co'
          }
        }
      },
      { upsert: true, new: true }
    );
    console.log('Seeded Global Email Config');

    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
};

seed();
