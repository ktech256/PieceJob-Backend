import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const redesignedTemplates = [
  {
    templateCode: 'WELCOME_EMAIL',
    subject: 'Welcome to PieceJob, {{firstName}}!',
    body: `
      <h1>Welcome to the future of work, {{firstName}}!</h1>
      <p>We're thrilled to have you join our global community of professionals and service seekers. PieceJob is designed to make high-quality services accessible, transparent, and efficient for everyone.</p>
      <div class="card">
        <p style="margin:0; font-weight:bold; color:#121212;">What's next?</p>
        <p style="margin:10px 0 0 0; font-size:14px;">Complete your profile and start exploring local services in your area. Whether you're looking for help or looking to provide it, we've got you covered.</p>
      </div>
      <a href="https://piecejob.co/get-started" class="button">Start Exploring</a>
    `
  },
  {
    templateCode: 'JOB_REQUEST_CONFIRMATION',
    subject: 'Job Request Confirmed: {{serviceName}}',
    body: `
      <h1>Your request is live, {{firstName}}!</h1>
      <p>We've successfully logged your request for <b>{{serviceName}}</b>. Our system is now matching you with the most qualified professionals in your vicinity.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Booking Reference</span>
            <span class="detail-value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Service Category</span>
            <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value" style="color:#D32F2F;">Finding Professional...</span>
        </div>
      </div>
      <p>We will notify you immediately once a provider accepts your request. You can track all updates in real-time within the PieceJob app.</p>
      <a href="https://piecejob.co/jobs/{{jobId}}" class="button">View Live Status</a>
    `
  },
  {
    templateCode: 'PROVIDER_ASSIGNED',
    subject: 'Professional Assigned: {{providerName}} is on the job!',
    body: `
      <h1>Great news, {{firstName}}!</h1>
      <p>A top-tier professional has accepted your request for <b>{{serviceName}}</b> and is now assigned to your booking.</p>
      <div class="card">
        <div style="text-align:center; margin-bottom:20px;">
            <p style="font-size:18px; font-weight:900; margin:0; color:#121212;">{{providerName}}</p>
            <p style="font-size:12px; color:#888; text-transform:uppercase; margin-top:4px;">Verified PieceJob Pro</p>
        </div>
        <div class="detail-row">
            <span class="detail-label">Job Reference</span>
            <span class="detail-value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Service</span>
            <span class="detail-value">{{serviceName}}</span>
        </div>
      </div>
      <p>You can now chat with {{providerName}} directly in the app to finalize any details or provide location specifics.</p>
      <a href="https://piecejob.co/jobs/{{jobId}}/track" class="button">Track & Chat</a>
    `
  },
  {
    templateCode: 'JOB_COMPLETED_RECEIPT',
    subject: 'Official Receipt: Job #{{jobId}} Completed',
    body: `
      <h1>Job successfully completed!</h1>
      <p>Hi {{firstName}}, your booking for <b>{{serviceName}}</b> has been finalized. We hope you had a great experience with your provider.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Receipt Number</span>
            <span class="detail-value">PJ-RC-{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Service Rendered</span>
            <span class="detail-value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Completion Date</span>
            <span class="detail-value">{{time}}</span>
        </div>
      </div>
      <p>Your official tax receipt is attached to this email as a PDF for your records. Please take a moment to rate your provider to help maintain our high service standards.</p>
      <a href="https://piecejob.co/rate/{{jobId}}" class="button">Rate Your Experience</a>
    `
  },
  {
    templateCode: 'LOGIN_ALERT',
    category: 'SECURITY',
    subject: 'Security Alert: New login detected',
    body: `
      <h1 style="color:#D32F2F;">New Login Detected</h1>
      <p>Hi {{firstName}}, we noticed a successful login to your account from a new location or device. Security is our top priority, so we wanted to make sure it was you.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Time</span>
            <span class="detail-value">{{time}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">IP Address</span>
            <span class="detail-value">{{ip}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Location</span>
            <span class="detail-value">Approximate: {{location}}</span>
        </div>
      </div>
      <p>If this was you, you can safely ignore this email. <b>If this was not you</b>, please click the button below to secure your account and reset your password immediately.</p>
      <a href="https://piecejob.co/secure-account" class="button" style="background-color:#121212;">Secure Account</a>
    `
  },
  {
    templateCode: 'PROVIDER_NET_EARNINGS',
    category: 'PROVIDER',
    subject: 'Earnings Released! {{currency}} {{amount}} credited',
    body: `
      <h1 style="color:#2E7D32;">You've been paid!</h1>
      <p>Great work on job <b>{{serviceName}}</b>! Your net earnings have been successfully calculated and released to your PieceJob wallet.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Gross Amount</span>
            <span class="detail-value">{{currency}} {{amount}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Service Code</span>
            <span class="detail-value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value" style="color:#2E7D32;">Released to Main Balance</span>
        </div>
      </div>
      <p>Your funds are now available for withdrawal. Keep up the high rating to unlock more high-value jobs!</p>
      <a href="https://piecejob.co/provider/wallet" class="button" style="background-color:#2E7D32;">View Wallet</a>
    `
  },
  {
    templateCode: 'SERVICE_FEE_REMINDER',
    category: 'PROVIDER',
    subject: 'Urgent: Service Fee Balance Reminder',
    body: `
      <h1 style="color:#D32F2F;">Action Required</h1>
      <p>Hi {{firstName}}, this is a reminder regarding your outstanding service fee balance. To continue receiving new job matches, please ensure your balance is settled.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Outstanding Balance</span>
            <span class="detail-value">{{currency}} {{balance}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Suspension Threshold</span>
            <span class="detail-value">{{currency}} {{threshold}}</span>
        </div>
      </div>
      <p>If your balance exceeds the threshold, your account will be automatically set to offline until the fees are paid. You can settle this instantly via vouchers in the app.</p>
      <a href="https://piecejob.co/provider/pay-fees" class="button" style="background-color:#121212;">Settle Balance Now</a>
    `
  },
  {
    templateCode: 'PROVIDER_EN_ROUTE',
    category: 'CUSTOMER',
    subject: 'Update: Your pro is on the way!',
    body: `
      <h1>Heads up! Your pro is coming</h1>
      <p>Hi {{firstName}}, great news! <b>{{providerName}}</b> has started their journey and is currently en-route to your location for job <b>{{service}}</b>.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Arrival Window</span>
            <span class="detail-value">Tracking Live</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Professional</span>
            <span class="detail-value">{{providerName}}</span>
        </div>
      </div>
      <p>You can now see the provider\'s location in real-time on the live tracking map.</p>
      <a href="https://piecejob.co/track/{{jobId}}" class="button">Open Tracking Map</a>
    `
  },
  {
    templateCode: 'PROVIDER_ARRIVED',
    category: 'CUSTOMER',
    subject: 'Pro Alert: Provider has Arrived!',
    body: `
      <h1>Your pro is here!</h1>
      <p>Hi {{firstName}}, your professional for <b>{{serviceName}}</b> has arrived at your location.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Job Reference</span>
            <span class="detail-value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Location Status</span>
            <span class="detail-value" style="color:#2E7D32;">ARRIVED</span>
        </div>
      </div>
      <p>Please meet <b>{{providerName}}</b> to start the service. Ensure you verify the professional before beginning work.</p>
      <a href="https://piecejob.co/jobs/{{jobId}}" class="button">View Job Controls</a>
    `
  },
  {
    templateCode: 'WITHDRAWAL_COMPLETED',
    category: 'WALLET',
    subject: 'Funds Dispatched: Withdrawal Successful',
    body: `
      <h1 style="color:#2E7D32;">Withdrawal Processed</h1>
      <p>Hi {{firstName}}, your withdrawal request for <b>{{currency}} {{amount}}</b> has been successfully processed and dispatched to your bank account.</p>
      <div class="card">
        <div class="detail-row">
            <span class="detail-label">Amount Transferred</span>
            <span class="detail-value">{{currency}} {{amount}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Bank Reference</span>
            <span class="detail-value">{{reference}}</span>
        </div>
      </div>
      <p>Depending on your bank, it may take 1-3 business days for the funds to reflect in your account.</p>
      <a href="https://piecejob.co/wallet/history" class="button" style="background-color:#121212;">View Transaction History</a>
    `
  }
];

const update = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    for (const t of redesignedTemplates) {
      await NotificationTemplate.findOneAndUpdate(
        { templateCode: t.templateCode, channel: 'EMAIL', countryCode: 'GLOBAL' },
        { $set: { body: t.body, subject: t.subject } },
        { upsert: false }
      );
      console.log(`Redesigned template: ${t.templateCode}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Update failed:', error);
    process.exit(1);
  }
};

update();
