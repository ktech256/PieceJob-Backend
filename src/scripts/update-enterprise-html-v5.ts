import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const redesignedTemplates = [
  {
    templateCode: 'PROVIDER_ASSIGNED',
    subject: 'Request Accepted: {{providerName}} is on the job!',
    body: `
      <h1 class="h1">Great news, {{firstName}}!</h1>
      <p class="p">A professional has accepted your booking for <b>{{serviceName}}</b> and is now assigned to your request.</p>

      <div class="card">
        <div style="text-align: center; margin-bottom: 25px;">
            <p style="font-size: 20px; font-weight: 900; margin: 0; color: #121212;">{{providerName}}</p>
            <p style="font-size: 14px; color: #FFA000; font-weight: 900; margin-top: 4px;">★ {{providerRating}}</p>
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
        <div class="detail-row">
            <span class="label">Est. Arrival</span>
            <span class="value">{{eta}}</span>
        </div>
      </div>

      <p class="p">You can now chat with {{providerName}} directly to coordinate any specific details or track their progress in real-time.</p>

      <div style="text-align: center; margin-top: 30px;">
        <a href="https://piecejob.co/jobs/{{jobId}}" class="button" style="background-color: #FF9900;">View Job Tracking</a>
      </div>

      <div style="display: table; width: 100%; margin-top: 20px;">
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/chat/{{jobId}}" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #121212; box-shadow: none; font-size: 11px;">Contact Provider</a>
        </div>
        <div style="display: table-cell; width: 4%;"></div>
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/support" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #f0f0f0; color: #121212 !important; box-shadow: none; font-size: 11px;">Get Support</a>
        </div>
      </div>
    `,
    placeholders: ['firstName', 'serviceName', 'providerName', 'providerRating', 'jobId', 'eta']
  },
  {
    templateCode: 'JOB_COMPLETED_RECEIPT',
    subject: 'Payment Receipt: {{serviceName}} [PJ-{{jobId}}]',
    body: `
      <h1 class="h1">Payment Receipt</h1>
      <p class="p">Hi {{firstName}}, thank you for using PieceJob. Your payment has been successfully processed for <b>{{serviceName}}</b>.</p>

      <div class="card" style="border: 2px solid #f0f0f0; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #121212; padding-bottom: 20px;">
            <p style="font-size: 11px; font-weight: 900; color: #999; text-transform: uppercase; margin-bottom: 5px; letter-spacing: 0.1em;">Total Paid</p>
            <div style="font-size: 48px; font-weight: 900; color: #121212;">{{currency}} {{amount}}</div>
            <p style="font-size: 12px; font-weight: 700; color: #121212; margin-top: 5px;">Completed: {{time}}</p>
        </div>

        <div style="margin-bottom: 30px;">
            <p style="font-size: 12px; font-weight: 900; color: #121212; text-transform: uppercase; margin-bottom: 15px; letter-spacing: 0.05em;">Financial Breakdown</p>
            <div class="detail-row">
                <span class="label">Booking Fee</span>
                <span class="value">{{currency}} {{bookingFee}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Provider Service</span>
                <span class="value">{{currency}} {{negotiatedAmount}}</span>
            </div>
            <div class="detail-row" style="border-top: 1px solid #121212; padding-top: 12px; margin-top: 5px;">
                <span class="label" style="color:#121212; font-weight:900;">Total Paid</span>
                <span class="value" style="color:#121212; font-weight:900;">{{currency}} {{amount}}</span>
            </div>
        </div>

        <div style="margin-bottom: 30px;">
            <p style="font-size: 12px; font-weight: 900; color: #121212; text-transform: uppercase; margin-bottom: 15px; letter-spacing: 0.05em;">Payment Details</p>
            <div class="detail-row">
                <span class="label">Method</span>
                <span class="value">{{paymentMethod}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Transaction Ref</span>
                <span class="value">{{transactionRef}}</span>
            </div>
        </div>

        <div style="margin-bottom: 30px;">
            <p style="font-size: 12px; font-weight: 900; color: #121212; text-transform: uppercase; margin-bottom: 15px; letter-spacing: 0.05em;">Job Summary</p>
            <div class="detail-row">
                <span class="label">Reference</span>
                <span class="value">#{{jobId}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Professional</span>
                <span class="value">{{providerName}} (★{{providerRating}})</span>
            </div>
            <div class="detail-row">
                <span class="label">Duration</span>
                <span class="value">{{duration}}</span>
            </div>
        </div>

        <div style="text-align: center;">
            <a href="{{downloadUrl}}" class="button" style="background-color: #121212;">Download PDF Receipt</a>
        </div>
      </div>

      <div style="display: table; width: 100%; margin-top: 20px;">
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/rate/{{jobId}}" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #FF9900; box-shadow: none; font-size: 11px;">Rate Provider</a>
        </div>
        <div style="display: table-cell; width: 4%;"></div>
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/support/report/{{jobId}}" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #f0f0f0; color: #121212 !important; box-shadow: none; font-size: 11px;">Report Issue</a>
        </div>
      </div>
    `,
    placeholders: ['firstName', 'serviceName', 'jobId', 'providerName', 'providerRating', 'amount', 'currency', 'time', 'address', 'duration', 'bookingFee', 'negotiatedAmount', 'downloadUrl', 'paymentMethod', 'transactionRef']
  },
  {
    templateCode: 'PROVIDER_JOB_COMPLETED',
    subject: 'Job Completed Successfully - Earnings Receipt [PJ-{{jobId}}]',
    body: `
      <h1 class="h1">Job Completed Successfully</h1>
      <p class="p">Hi {{firstName}}, great work! You've successfully completed the job for <b>{{customerName}}</b>. Your earnings have been calculated and credited to your wallet.</p>

      <div class="card" style="border-left: 4px solid #2E7D32;">
        <div style="margin-bottom: 25px; border-bottom: 1px solid #f0f0f0; padding-bottom: 15px;">
            <p style="font-size: 10px; font-weight: 900; color: #999; text-transform: uppercase; margin-bottom: 5px;">Net Earnings</p>
            <div style="font-size: 36px; font-weight: 900; color: #2E7D32;">{{currency}} {{netEarnings}}</div>
        </div>

        <div style="margin-bottom: 25px;">
            <p style="font-size: 11px; font-weight: 900; color: #121212; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.05em;">Earnings Breakdown</p>
            <div class="detail-row">
                <span class="label">Gross Job Value</span>
                <span class="value">{{currency}} {{grossAmount}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Booking Fee (Paid)</span>
                <span class="value">{{currency}} {{bookingFee}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Service Amount</span>
                <span class="value">{{currency}} {{negotiatedAmount}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Platform Service Fee</span>
                <span class="value" style="color: #D32F2F;">- {{currency}} {{platformFee}}</span>
            </div>
            <div class="detail-row" style="border-top: 1px solid #eee; padding-top: 10px; margin-top: 5px;">
                <span class="label" style="color:#121212; font-weight:800;">Net Payout</span>
                <span class="value" style="color:#121212; font-weight:800;">{{currency}} {{netEarnings}}</span>
            </div>
        </div>

        <div style="margin-bottom: 25px;">
            <p style="font-size: 11px; font-weight: 900; color: #121212; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.05em;">Job Summary</p>
            <div class="detail-row">
                <span class="label">Reference</span>
                <span class="value">#{{jobId}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Service</span>
                <span class="value">{{serviceName}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Location</span>
                <span class="value">{{suburb}}, {{city}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Started At</span>
                <span class="value">{{startTime}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Completed At</span>
                <span class="value">{{completionTime}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Duration</span>
                <span class="value">{{duration}}</span>
            </div>
        </div>

        <div style="margin-bottom: 25px;">
            <p style="font-size: 11px; font-weight: 900; color: #121212; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.05em;">Payment Information</p>
            <div class="detail-row">
                <span class="label">Transaction Ref</span>
                <span class="value">{{transactionRef}}</span>
            </div>
            <div class="detail-row">
                <span class="label">Wallet Credit</span>
                <span class="value">{{currency}} {{walletCredit}}</span>
            </div>
        </div>

        <div style="text-align: center; margin-top: 10px;">
            <a href="https://api.piecejob.co/api/v1/jobs/{{jobId}}/receipt/download" class="button" style="background-color: #121212; padding: 15px 30px;">Download PDF Receipt</a>
        </div>
      </div>

      <div style="display: table; width: 100%; margin-top: 30px;">
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/provider/earnings" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #2E7D32; box-shadow: none; font-size: 11px;">View Earnings</a>
        </div>
        <div style="display: table-cell; width: 4%;"></div>
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/provider/support" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #f0f0f0; color: #121212 !important; box-shadow: none; font-size: 11px;">Support Centre</a>
        </div>
      </div>
    `,
    placeholders: ['firstName', 'jobId', 'serviceName', 'customerName', 'completionDate', 'completionTime', 'startTime', 'duration', 'suburb', 'city', 'bookingFee', 'negotiatedAmount', 'grossAmount', 'platformFee', 'netEarnings', 'currency', 'transactionRef', 'walletCredit']
  }
];

const update = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    for (const t of redesignedTemplates) {
      await NotificationTemplate.findOneAndUpdate(
        { templateCode: t.templateCode, channel: 'EMAIL', countryCode: 'GLOBAL' },
        { $set: { body: t.body, subject: t.subject, placeholders: t.placeholders } },
        { upsert: true }
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
