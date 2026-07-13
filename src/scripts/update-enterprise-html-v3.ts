import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const redesignedTemplates = [
  {
    templateCode: 'JOB_REQUEST_CONFIRMATION',
    subject: 'Request Received: {{serviceName}}',
    body: `
      <h1 class="h1">Your request is in the works!</h1>
      <p class="p">Hello {{firstName}}, we've successfully logged your request for <b>{{serviceName}}</b>. Our system is currently matching you with the most qualified professionals available.</p>

      <div class="card">
        <div class="detail-row">
            <span class="label">Job Reference</span>
            <span class="value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Service</span>
            <span class="value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Status</span>
            <span class="value highlight">SEARCHING...</span>
        </div>
      </div>

      <p class="p">We'll notify you the moment a professional accepts your request. You can track all updates in real-time within the app.</p>

      <div style="text-align: center;">
        <a href="https://piecejob.co/jobs/{{jobId}}" class="button">Track Request</a>
      </div>
    `
  },
  {
    templateCode: 'PROVIDER_ASSIGNED',
    subject: 'Pro Assigned: {{providerName}} has accepted your job!',
    body: `
      <h1 class="h1">Great news, {{firstName}}!</h1>
      <p class="p">A professional has accepted your booking for <b>{{serviceName}}</b> and is now assigned to your request.</p>

      <div class="card">
        <div style="text-align: center; margin-bottom: 25px;">
            <p style="font-size: 20px; font-weight: 900; margin: 0; color: #121212;">{{providerName}}</p>
            <p style="font-size: 12px; color: #888; text-transform: uppercase; margin-top: 5px; letter-spacing: 0.1em;">Verified PieceJob Pro</p>
        </div>
        <div class="detail-row">
            <span class="label">Job ID</span>
            <span class="value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Service</span>
            <span class="value">{{serviceName}}</span>
        </div>
      </div>

      <p class="p">You can now chat with {{providerName}} directly to coordinate any specific details before they arrive.</p>

      <div style="text-align: center;">
        <a href="https://piecejob.co/chat/{{jobId}}" class="button">Chat with Pro</a>
      </div>
    `
  },
  {
    templateCode: 'PROVIDER_ARRIVED',
    subject: 'Oracle Alert: Your Pro has Arrived!',
    body: `
      <h1 class="h1">Your professional is here!</h1>
      <p class="p">Hi {{firstName}}, your professional for <b>{{serviceName}}</b> has arrived at the location.</p>

      <div class="card">
        <div style="text-align: center; margin-bottom: 25px;">
            <p style="font-size: 18px; font-weight: 900; margin: 0; color: #121212;">{{providerName}} is ready</p>
        </div>
        <div class="detail-row">
            <span class="label">Job ID</span>
            <span class="value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Status</span>
            <span class="value highlight">ARRIVED</span>
        </div>
      </div>

      <p class="p">Please meet <b>{{providerName}}</b> to begin the service. Ensure you verify the pro's identity in the app before starting work.</p>

      <div style="text-align: center;">
        <a href="https://piecejob.co/jobs/{{jobId}}" class="button">Manage Job</a>
      </div>
    `
  },
  {
    templateCode: 'JOB_COMPLETED_RECEIPT',
    subject: 'PieceJob Receipt: {{serviceName}} [PJ-{{jobId}}]',
    body: `
      <h1 class="h1">Thanks for using PieceJob, {{firstName}}!</h1>
      <p class="p">Your job for <b>{{serviceName}}</b> was completed successfully. We hope you're satisfied with the service provided.</p>

      <div class="card">
        <div style="margin-bottom: 25px; border-bottom: 2px solid #121212; padding-bottom: 15px;">
            <span style="font-size: 10px; font-weight: 900; color: #999; text-transform: uppercase;">Total Paid</span>
            <div style="font-size: 36px; font-weight: 900; color: #121212;">{{currency}} {{amount}}</div>
        </div>

        <div class="detail-row">
            <span class="label">Service</span>
            <span class="value">{{serviceName}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Job Reference</span>
            <span class="value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Professional</span>
            <span class="value">{{providerName}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Completed At</span>
            <span class="value">{{time}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Duration</span>
            <span class="value">{{duration}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Location</span>
            <span class="value">{{address}}</span>
        </div>
      </div>

      <div style="background-color: #f8f9fa; border-radius: 16px; padding: 25px; margin-bottom: 30px;">
        <p style="font-size: 12px; font-weight: 800; color: #999; text-transform: uppercase; margin-bottom: 15px; letter-spacing: 0.05em;">Rate your experience</p>
        <p class="p" style="font-size: 14px;">How was the quality of work from <b>{{providerName}}</b>? Your feedback helps keep PieceJob safe and reliable.</p>
        <a href="https://piecejob.co/rate/{{jobId}}" style="color: #FF9900; font-weight: 900; text-decoration: none; font-size: 14px; text-transform: uppercase;">Leave a Rating &rarr;</a>
      </div>

      <p class="p" style="font-size: 14px; color: #888;">Your detailed official tax receipt is attached to this email as a PDF.</p>

      <div style="text-align: center;">
        <a href="https://piecejob.co/support" class="button" style="background-color: #121212;">Need Help?</a>
      </div>
    `
  },
  {
    templateCode: 'LOGIN_ALERT',
    subject: 'Security: New Login detected',
    body: `
      <h1 class="h1" style="color: #D32F2F;">New login detected</h1>
      <p class="p">Hi {{firstName}}, we noticed a new successful login to your PieceJob account. If this was you, you can safely ignore this email.</p>

      <div class="card">
        <div class="detail-row">
            <span class="label">Time</span>
            <span class="value">{{time}}</span>
        </div>
        <div class="detail-row">
            <span class="label">IP Address</span>
            <span class="value">{{ip}}</span>
        </div>
      </div>

      <div class="support-section">
        <p class="p" style="font-size: 14px; font-weight: bold; margin-bottom: 10px;">Wasn't you?</p>
        <p class="p" style="font-size: 13px;">If you don't recognize this activity, please secure your account immediately by resetting your password.</p>
        <a href="https://piecejob.co/secure-account" class="button" style="background-color: #121212;">Secure Account</a>
      </div>
    `
  },
  {
    templateCode: 'WELCOME_EMAIL',
    subject: 'Welcome to PieceJob!',
    body: `
      <h1 class="h1">The world of PieceJob awaits!</h1>
      <p class="p">Hi {{firstName}}, thank you for joining PieceJob. We're on a mission to connect the best local professionals with people who need work done—fast, safely, and reliably.</p>

      <div class="card" style="background-color: #FFF9F0; border-color: #FFE5D0;">
        <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 900; color: #FF9900;">Getting Started</h3>
        <ul style="padding-left: 20px; margin: 0; color: #4a4a4a; font-size: 14px;">
            <li style="margin-bottom: 10px;"><b>Complete your profile</b> - Let people know who you are.</li>
            <li style="margin-bottom: 10px;"><b>Browse Services</b> - Find exactly what you need in seconds.</li>
            <li style="margin-bottom: 0;"><b>Get Verified</b> - Build trust within our community.</li>
        </ul>
      </div>

      <div style="text-align: center;">
        <a href="https://piecejob.co/start" class="button">Explore Marketplace</a>
      </div>

      <div class="divider"></div>

      <p class="p" style="font-size: 13px; text-align: center; color: #999;">Download our mobile app for the full Oracle experience.</p>
      <div style="text-align: center;">
        <a href="#"><img src="https://api.piecejob.co/assets/icons/app-store.png" height="40" style="margin: 0 5px;"></a>
        <a href="#"><img src="https://api.piecejob.co/assets/icons/play-store.png" height="40" style="margin: 0 5px;"></a>
      </div>
    `
  },
  {
    templateCode: 'JOB_POSTED_SUCCESS',
    subject: 'Action Required: Your job for {{serviceName}} is live!',
    body: `
      <h1 class="h1">Almost there!</h1>
      <p class="p">Hi {{firstName}}, you've successfully drafted your request for <b>{{serviceName}}</b>. To begin matching with our pool of top professionals, please complete the booking fee payment.</p>

      <div class="card">
        <div class="detail-row">
            <span class="label">Job Reference</span>
            <span class="value">#{{jobId}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Service</span>
            <span class="value">{{serviceName}}</span>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="https://piecejob.co/jobs/{{jobId}}/pay" class="button">Pay Booking Fee</a>
      </div>
    `
  },
  {
    templateCode: 'PROVIDER_EN_ROUTE',
    subject: 'Travel Alert: Your pro is on the way!',
    body: `
      <h1 class="h1">Heads up, your pro is coming!</h1>
      <p class="p">Hello {{firstName}}, your professional <b>{{providerName}}</b> has just started traveling to your location for the <b>{{serviceName}}</b> request.</p>

      <div class="card">
        <div class="detail-row">
            <span class="label">Professional</span>
            <span class="value">{{providerName}}</span>
        </div>
        <div class="detail-row">
            <span class="label">Status</span>
            <span class="value highlight">EN-ROUTE</span>
        </div>
      </div>

      <p class="p">You can monitor their real-time location on the map to see exactly when they'll arrive.</p>

      <div style="text-align: center;">
        <a href="https://piecejob.co/jobs/{{jobId}}/track" class="button">Open Live Map</a>
      </div>
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
