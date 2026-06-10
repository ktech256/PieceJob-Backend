import { Request, Response } from 'express';
import * as webhookService from '../services/webhook.service';
import * as financialService from '../services/financial.service';
import Job, { JobStatus } from '../models/Job';
import * as jobService from '../services/job.service';

export const handlePaystackWebhook = async (req: Request, res: Response) => {
    const gateway = 'PAYSTACK';
    const gatewayEventId = req.body.id || req.headers['x-paystack-id']; // Example

    if (await webhookService.isDuplicateWebhook(gateway, gatewayEventId, req.body)) {
        return res.status(200).json({ success: true, message: 'Duplicate skipped' });
    }

    try {
        const { event, data } = req.body;

        if (event === 'charge.success') {
            const jobId = data.metadata.jobId;
            const job = await Job.findById(jobId);

            if (job && job.paymentStatus !== 'PAID') {
                await financialService.handleBookingFee(
                    job.id,
                    job.customerId.toString(),
                    job.bookingFee,
                    data.currency,
                    job.countryCode
                );

                job.paymentStatus = 'PAID';
                job.status = JobStatus.BROADCASTED;
                await job.save();

                jobService.broadcastJob(job.id);
            }
        }

        await webhookService.markWebhookProcessed(gateway, gatewayEventId);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing failed:', error);
        res.status(500).json({ success: false });
    }
};
