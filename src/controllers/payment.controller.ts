import { Request, Response } from 'express';
import * as paystackService from '../services/paystack.service';
import { AuthRequest } from '../middleware/auth.middleware';
import * as webhookService from '../services/webhook.service';
import * as financialService from '../services/financial.service';
import Job, { JobStatus } from '../models/Job';
import * as jobService from '../services/job.service';
import { emitAdminUpdate } from '../socket/socket.service';

export const handlePaystackWebhook = async (req: Request, res: Response) => {
    const gateway = 'PAYSTACK';
    const gatewayEventId = req.body.id || req.headers['x-paystack-id'];

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
                emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });
            }
        }

        await webhookService.markWebhookProcessed(gateway, gatewayEventId);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing failed:', error);
        res.status(500).json({ success: false });
    }
};

export const verifyPayment = async (req: AuthRequest, res: Response) => {
    try {
        const { reference } = req.params;
        const verification = await paystackService.verifyTransaction(reference, req.user?.countryCode || 'ZA');

        if (verification.status && verification.data.status === 'success') {
            const jobId = verification.data.metadata.jobId;
            const job = await Job.findById(jobId);

            if (job && job.paymentStatus !== 'PAID') {
                await financialService.handleBookingFee(
                    job.id,
                    job.customerId.toString(),
                    job.bookingFee,
                    verification.data.currency,
                    job.countryCode
                );

                job.paymentStatus = 'PAID';
                job.status = JobStatus.BROADCASTED;
                await job.save();

                jobService.broadcastJob(job.id);
                emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });
            }

            return res.status(200).json({
                success: true,
                message: 'Payment verified',
                data: {
                    ...job.toObject(),
                    id: job._id,
                    currency: job.pricingSnapshot?.currencyCode || verification.data.currency
                }
            });
        } else {
            return res.status(400).json({ success: false, message: 'Payment not successful' });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
