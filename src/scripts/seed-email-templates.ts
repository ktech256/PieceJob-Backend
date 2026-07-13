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
    templateCode: 'PASSWORD_CHANGED',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Security Notice: PieceJob Password Changed',
    body: '<p>Hi {{firstName}},</p><p>This is a confirmation that your PieceJob password was successfully changed on <b>{{time}}</b>.</p><p>If you did not authorize this change, please contact support immediately.</p>',
    placeholders: ['firstName', 'time'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'NEGOTIATION_ACCEPTED',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Negotiation Success! Price Agreed',
    body: '<p>Hi {{firstName}},</p><p>A final price of <b>{{amount}}</b> has been agreed for job <b>{{serviceName}}</b>.</p><p>The provider is now authorized to proceed.</p>',
    placeholders: ['firstName', 'amount', 'jobId', 'serviceName'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'NEGOTIATION_TERMINATED',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Negotiation Terminated',
    body: '<p>Hi {{firstName}},</p><p>The negotiation for job <b>{{serviceName}}</b> has been terminated. The job has been re-broadcasted to other professionals.</p>',
    placeholders: ['firstName', 'jobId', 'serviceName'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PROVIDER_ARRIVED',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Pro Alert: Provider has Arrived!',
    body: '<p>Hi {{firstName}},</p><p>Your professional for <b>{{serviceName}}</b> has arrived at the location.</p><p>Please meet them to start the work.</p>',
    placeholders: ['firstName', 'serviceName', 'jobId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'WALLET_CREDITED',
    channel: 'EMAIL',
    category: 'WALLET',
    language: 'EN',
    subject: 'Wallet Update: Funds Credited',
    body: '<p>Hi {{firstName}},</p><p>Your PieceJob wallet has been credited with <b>{{currency}} {{amount}}</b>.</p><p>Description: {{description}}</p><p>New Balance: {{balance}}</p>',
    placeholders: ['firstName', 'amount', 'currency', 'description', 'balance'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'WALLET_DEBITED',
    channel: 'EMAIL',
    category: 'WALLET',
    language: 'EN',
    subject: 'Wallet Update: Payment Processed',
    body: '<p>Hi {{firstName}},</p><p>A payment of <b>{{currency}} {{amount}}</b> was processed from your wallet.</p><p>Description: {{description}}</p><p>Remaining Balance: {{balance}}</p>',
    placeholders: ['firstName', 'amount', 'currency', 'description', 'balance'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'ACCOUNT_SUSPENDED',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Notice: Your PieceJob Account is Suspended',
    body: '<p>Hi {{firstName}},</p><p>Your account has been suspended by the administration.</p><p>Reason: <b>{{reason}}</b></p><p>If you wish to appeal this decision, please reply to this email.</p>',
    placeholders: ['firstName', 'reason'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'ACCOUNT_REACTIVATED',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Good News: Your Account is Active',
    body: '<p>Hi {{firstName}},</p><p>Your PieceJob account has been reactivated. You can now login and continue using our platform.</p>',
    placeholders: ['firstName'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'NEGOTIATION_EXPIRED',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Negotiation Expired - PieceJob',
    body: '<p>Hi {{firstName}},</p><p>The price negotiation for job <b>{{serviceName}}</b> has expired due to inactivity.</p><p>Please restart the negotiation or re-post the job if you still need the service.</p>',
    placeholders: ['firstName', 'serviceName', 'jobId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'BOOKING_FEE_RECEIPT',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Booking Fee Receipt - {{jobId}}',
    body: '<p>Hi {{firstName}},</p><p>Thank you for your booking! We have received your booking fee of <b>{{currency}} {{amount}}</b> for job ID <b>{{jobId}}</b>.</p><p>Reference: {{reference}}</p>',
    placeholders: ['firstName', 'amount', 'currency', 'reference', 'jobId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PROVIDER_NET_EARNINGS',
    channel: 'EMAIL',
    category: 'PROVIDER',
    language: 'EN',
    subject: 'Earnings Credited! Job #{{jobId}}',
    body: '<p>Hi {{firstName}},</p><p>Good news! Your net earnings of <b>{{currency}} {{amount}}</b> for job <b>{{serviceName}}</b> have been released to your main balance.</p>',
    placeholders: ['firstName', 'amount', 'currency', 'jobId', 'serviceName'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'WITHDRAWAL_REQUESTED',
    channel: 'EMAIL',
    category: 'WALLET',
    language: 'EN',
    subject: 'Withdrawal Request Received',
    body: '<p>Hi {{firstName}},</p><p>We have received your withdrawal request for <b>{{currency}} {{amount}}</b>. Our finance team will process it within the next business window.</p>',
    placeholders: ['firstName', 'amount', 'currency'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'SERVICE_FEE_RECEIPT',
    channel: 'EMAIL',
    category: 'PROVIDER',
    language: 'EN',
    subject: 'Service Fee Payment Received',
    body: '<p>Hi {{firstName}},</p><p>Thank you for your payment of <b>{{currency}} {{amount}}</b> toward your service fees.</p><p>Payment Method: {{vendor}}</p>',
    placeholders: ['firstName', 'amount', 'currency', 'vendor'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'EMAIL_CHANGED',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Security: PieceJob Email Address Updated',
    body: '<p>Hi {{firstName}},</p><p>Your PieceJob account email was successfully updated on <b>{{time}}</b>.</p><p>If you did not make this change, please contact support immediately.</p>',
    placeholders: ['firstName', 'time'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PHONE_CHANGED',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    language: 'EN',
    subject: 'Security: PieceJob Phone Number Updated',
    body: '<p>Hi {{firstName}},</p><p>Your PieceJob account phone number was successfully updated on <b>{{time}}</b>.</p><p>If you did not make this change, please contact support immediately.</p>',
    placeholders: ['firstName', 'time'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'TEST_EMAIL',
    channel: 'EMAIL',
    category: 'ADMIN',
    language: 'EN',
    subject: 'SMTP Oracle Connectivity Test Signal',
    body: '<h1>Oracle Signal Established</h1><p>Time: {{time}}</p><p>Recipient: {{recipient}}</p><p>This test signal confirms that your SMTP dispatch node is operational.</p>',
    placeholders: ['time', 'recipient'],
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
  },
  {
    templateCode: 'ADMIN_WEEKLY_SUMMARY',
    channel: 'EMAIL',
    category: 'ADMIN',
    language: 'EN',
    subject: 'PieceJob Weekly Workspace Performance Report - {{countryCode}}',
    body: '<h2>Weekly Performance Scorecard</h2><p>Period: {{period}}</p><ul><li>Total New Users: {{totalUsers}}</li><li>Total Jobs Created: {{totalJobs}}</li><li>Total Revenue Generated: {{totalRevenue}}</li></ul><p>Workspace: {{countryCode}}</p>',
    placeholders: ['period', 'totalUsers', 'totalJobs', 'totalRevenue', 'countryCode'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'MARKETING_ANNOUNCEMENT',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'EN',
    subject: '{{subject}}',
    body: '<p>Hi {{firstName}},</p><div>{{body}}</div>',
    placeholders: ['firstName', 'subject', 'body'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'PROVIDER_UNABLE_TO_LOCATE',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Alert: Provider Unable to Locate You',
    body: '<p>Hi {{firstName}},</p><p>Your professional for <b>{{serviceName}}</b> is at the location but is unable to find you.</p><p>Please contact them via chat or phone immediately to avoid job cancellation.</p>',
    placeholders: ['firstName', 'serviceName', 'jobId'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'SERVICE_FEE_REMINDER',
    channel: 'EMAIL',
    category: 'PROVIDER',
    language: 'EN',
    subject: 'Action Required: Service Fee Balance Reminder',
    body: '<p>Hi {{firstName}},</p><p>This is a reminder that you have an outstanding service fee balance of <b>{{currency}} {{balance}}</b>.</p><p>Please note that accounts with a balance exceeding <b>{{currency}} {{threshold}}</b> will be automatically suspended until settled.</p><p>You can pay your fees in the app using our voucher system.</p>',
    placeholders: ['firstName', 'balance', 'currency', 'threshold'],
    countryCode: 'GLOBAL'
  },
  {
    templateCode: 'FAILED_PAYMENT',
    channel: 'EMAIL',
    category: 'CUSTOMER',
    language: 'EN',
    subject: 'Payment Failed - PieceJob',
    body: '<p>Hi {{firstName}},</p><p>We were unable to process your payment of <b>{{currency}} {{amount}}</b> for job ID <b>{{jobId}}</b>.</p><p>Reason: <b>{{reason}}</b></p><p>Please try again with a different payment method.</p>',
    placeholders: ['firstName', 'amount', 'currency', 'jobId', 'reason'],
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
