import { Request, Response } from 'express';
import * as paystackService from '../services/paystack.service';
import { AuthRequest } from '../middleware/auth.middleware';
import * as webhookService from '../services/webhook.service';
import * as financialService from '../services/financial.service';
import Job, { JobStatus } from '../models/Job';
import * as jobService from '../services/job.service';
import { emitAdminUpdate, emitJobUpdate } from '../socket/socket.service';

export const handlePaystackWebhook = async (req: Request, res: Response) => {
    const gateway = 'PAYSTACK';
    const signature = req.headers['x-paystack-signature'] as string;
    const payload = req.body;

    if (!signature) {
        console.warn(`[PAYMENT_WEBHOOK] Missing signature for ${gateway}`);
        return res.status(400).json({ success: false, message: 'Missing signature' });
    }

    try {
        const { event, data } = payload;
        const jobId = data.metadata?.jobId;

        if (!jobId) {
            console.warn(`[PAYMENT_WEBHOOK] Missing Job ID in metadata for ${gateway}`);
            return res.status(200).json({ success: true, message: 'Job ID missing, ignoring' });
        }

        const job = await Job.findById(jobId);
        if (!job) {
            console.warn(`[PAYMENT_WEBHOOK] Job ${jobId} not found for ${gateway}`);
            return res.status(200).json({ success: true, message: 'Job not found' });
        }

        // Resolve config for signature verification
        const provider = await paystackService.getProviderConfig(job.countryCode);
        if (!provider || !provider.webhookSecret) {
            console.error(`[PAYMENT_WEBHOOK] Webhook secret not configured for ${job.countryCode}`);
            return res.status(500).json({ success: false, message: 'Webhook configuration error' });
        }

        if (!paystackService.isValidSignature(payload, signature, provider.webhookSecret)) {
            console.warn(`[PAYMENT_WEBHOOK] Invalid signature detected for Job ${jobId}`);
            return res.status(401).json({ success: false, message: 'Invalid signature' });
        }

        const gatewayEventId = payload.id || req.headers['x-paystack-id'];
        console.log(`[PAYMENT_WEBHOOK] Received valid event from ${gateway}. Event ID: ${gatewayEventId}`);

        if (await webhookService.isDuplicateWebhook(gateway, gatewayEventId, payload)) {
            console.log(`[PAYMENT_WEBHOOK] Duplicate event ${gatewayEventId} skipped.`);
            return res.status(200).json({ success: true, message: 'Duplicate skipped' });
        }

        if (event === 'charge.success') {
            console.log(`[PAYMENT_WEBHOOK] Success event for Job ID: ${jobId}. Reference: ${data.reference}`);

            if (job.paymentStatus !== 'PAID') {
// ...
                console.log(`[PAYMENT_WEBHOOK] Processing payment for Job ${jobId}...`);
                await financialService.handleBookingFee(
                    job.id,
                    job.customerId.toString(),
                    job.bookingFee,
                    data.currency,
                    job.countryCode
                );

                job.paymentStatus = 'PAID';
                job.status = JobStatus.BROADCASTED;
                job.paymentReference = data.reference;
                await job.save();

                console.log(`[PAYMENT_WEBHOOK] Job ${jobId} marked PAID. Triggering broadcast...`);
                jobService.broadcastJob(job.id);
                emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });

                // Signal customer app via Socket if connected
                emitJobUpdate(job.id, 'status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });
            } else {
                console.log(`[PAYMENT_WEBHOOK] Job ${jobId} already PAID or not found.`);
            }
        }

        await webhookService.markWebhookProcessed(gateway, gatewayEventId);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[PAYMENT_WEBHOOK] Processing failed:', error);
        res.status(500).json({ success: false });
    }
};

export const verifyPayment = async (req: AuthRequest, res: Response) => {
    try {
        const { reference } = req.params;
        console.log(`[PAYMENT_VERIFY] Starting verification for Reference: ${reference}`);

        const verification = await paystackService.verifyTransaction(reference, req.user?.countryCode || 'ZA');

        if (verification.status && verification.data.status === 'success') {
            const jobId = verification.data.metadata.jobId;
            console.log(`[PAYMENT_VERIFY] Verification passed for Job ID: ${jobId}`);

            const job = await Job.findById(jobId);
            if (!job) {
                console.error(`[PAYMENT_VERIFY] Job ${jobId} not found in database.`);
                return res.status(404).json({ success: false, message: 'Job not found' });
            }

            if (job.paymentStatus !== 'PAID') {
                console.log(`[PAYMENT_VERIFY] Finalizing payment for Job ${jobId}...`);
                await financialService.handleBookingFee(
                    job.id,
                    job.customerId.toString(),
                    job.bookingFee,
                    verification.data.currency,
                    job.countryCode
                );

                job.paymentStatus = 'PAID';
                job.status = JobStatus.BROADCASTED;
                job.paymentReference = reference;
                await job.save();

                console.log(`[PAYMENT_VERIFY] Job ${jobId} marked PAID. Triggering broadcast...`);
                jobService.broadcastJob(job.id);
                emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });

                // Signal customer app
                emitJobUpdate(job.id, 'status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });
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
            console.warn(`[PAYMENT_VERIFY] Gateway reported non-success status for ${reference}: ${verification.data.status}`);
            return res.status(400).json({ success: false, message: 'Payment not successful' });
        }
    } catch (error: any) {
        console.error(`[PAYMENT_VERIFY] Fatal error during verification of ${req.params.reference}:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
};
