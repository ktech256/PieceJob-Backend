import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

const redesignedTemplates = [
  {
    templateCode: 'PROVIDER_JOB_COMPLETED',
    subject: 'Job Completed Successfully - Earnings Receipt [PJ-{{jobId}}]',
    body: `
      <h1 class="h1">Job Completed Successfully</h1>
      <p class="p">Hi {{firstName}}, great work! You've successfully completed the job for <b>{{customerName}}</b>. Your earnings have been calculated and credited to your escrow balance.</p>

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
                <span class="label">Duration</span>
                <span class="value">{{duration}}</span>
            </div>
        </div>

        <div style="text-align: center; margin-top: 10px;">
            <a href="https://piecejob.co/provider/jobs/{{jobId}}" class="button" style="background-color: #121212; padding: 15px 30px;">View Job Details</a>
        </div>
      </div>

      <div style="background-color: #f8f9fa; border-radius: 16px; padding: 20px; margin-top: 20px;">
        <p style="font-size: 12px; font-weight: 800; color: #999; text-transform: uppercase; margin-bottom: 10px;">Escrow Status</p>
        <p class="p" style="font-size: 13px; margin-bottom: 0;">These funds are currently in <b>Escrow</b> and will be released to your main wallet after the standard cooling period. You will receive another notification once they are available for withdrawal.</p>
      </div>

      <div style="display: table; width: 100%; margin-top: 30px;">
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/provider/wallet" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #2E7D32; box-shadow: none; font-size: 11px;">View Wallet</a>
        </div>
        <div style="display: table-cell; width: 4%;"></div>
        <div style="display: table-cell; width: 48%; vertical-align: top;">
            <a href="https://piecejob.co/provider/support" class="button" style="width: 100%; padding: 15px 0; text-align: center; background-color: #f0f0f0; color: #121212 !important; box-shadow: none; font-size: 11px;">Support Centre</a>
        </div>
      </div>
    `,
    placeholders: ['firstName', 'jobId', 'serviceName', 'customerName', 'completionDate', 'completionTime', 'startTime', 'duration', 'suburb', 'city', 'bookingFee', 'negotiatedAmount', 'grossAmount', 'platformFee', 'netEarnings', 'currency']
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
