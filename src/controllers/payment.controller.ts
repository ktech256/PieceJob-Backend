import { Request, Response } from 'express';
import * as paystackService from '../services/paystack.service';
import { AuthRequest } from '../middleware/auth.middleware';
import * as webhookService from '../services/webhook.service';
import * as financialService from '../services/financial.service';
import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import * as jobService from '../services/job.service';
import * as notificationQueue from '../services/notification.queue';
import { emitAdminUpdate, emitJobUpdate } from '../socket/socket.service';
import { logger } from '../utils/logger';

export const handlePaystackWebhook = async (req: Request, res: Response) => {
    const gateway = 'PAYSTACK';
    const signature = req.headers['x-paystack-signature'] as string;
    const rawBody = (req as any).rawBody;

    if (!signature) {
        logger.warn(`PAYMENT | WEBHOOK | Missing signature for ${gateway}`);
        return res.status(400).json({ success: false, message: 'Missing signature' });
    }

    if (!rawBody) {
        logger.error(`PAYMENT | WEBHOOK | Raw body not captured for ${gateway}.`);
        return res.status(500).json({ success: false, message: 'Body capture error' });
    }

    try {
        const payload = req.body;
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
        // NOTE: Paystack signs webhooks using the SECRET KEY by default.
        const provider = await paystackService.getProviderConfig(job.countryCode);
        const signingSecret = provider?.secretKey || provider?.webhookSecret;

        if (!signingSecret) {
            console.error(`[PAYMENT_WEBHOOK] No signing secret (Secret Key or Webhook Secret) configured for ${job.countryCode}`);
            return res.status(500).json({ success: false, message: 'Webhook configuration error' });
        }

        if (!paystackService.isValidSignature(rawBody, signature, signingSecret)) {
            console.warn(`[PAYMENT_WEBHOOK] Invalid signature detected for Job ${jobId}. Signature provided: ${signature.slice(0, 10)}...`);
            return res.status(401).json({ success: false, message: 'Invalid signature' });
        }

        const gatewayEventId = payload.id?.toString() || payload.data?.id?.toString() || payload.data?.reference || Date.now().toString();
        console.log(`[PAYMENT_WEBHOOK] Received valid event: ${event} from ${gateway}. Event ID: ${gatewayEventId}`);

        if (await webhookService.isDuplicateWebhook(gateway, gatewayEventId, payload)) {
            console.log(`[PAYMENT_WEBHOOK] Duplicate event ${gatewayEventId} skipped.`);
            return res.status(200).json({ success: true, message: 'Duplicate skipped' });
        }

        if (event === 'charge.success') {
            logger.payment('WEBHOOK_SUCCESS', 'PAID', data.reference, data.amount / 100);

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

export const verifyPayment = async (req: Request, res: Response) => {
    try {
        const { reference } = req.params;

        // Try to resolve countryCode from Job first if not authenticated (e.g. from Website callback)
        let countryCode = (req as any).user?.countryCode;
        if (!countryCode) {
            const job = await Job.findOne({ paymentReference: reference });
            if (job) countryCode = job.countryCode;
        }

        if (!countryCode) countryCode = 'ZA'; // Final fallback

        const verification = await paystackService.verifyTransaction(reference, countryCode);

        if (verification.status && verification.data.status === 'success') {
            const jobId = verification.data.metadata.jobId;
            logger.payment('VERIFY_SUCCESS', 'PAID', reference);

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
                    id: job._id.toString(),
                    customerId: job.customerId.toString(),
                    providerId: job.providerId ? job.providerId.toString() : null,
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
