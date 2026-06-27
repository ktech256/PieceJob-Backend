import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import * as jobService from '../services/job.service';
import * as pricingService from '../services/pricing.service';
import * as financialService from '../services/financial.service';
import Provider from '../models/Provider';
import AuditLog from '../models/AuditLog';
import mongoose from 'mongoose';
import { emitAdminUpdate, emitJobUpdate, emitToUser } from '../socket/socket.service';

import * as performanceService from '../services/provider-performance.service';
import * as zoneResolverService from '../services/zone-resolver.service';
import * as fraudService from '../services/fraud.service';
import * as notificationService from '../services/notification.service';
import * as testUserService from '../services/test-user.service';
import * as paymentGatewayService from '../services/payment-gateway.service';
import { logger } from '../utils/logger';
import { calculateDistance } from '../utils/location';

const sanitizeJobForMobile = (job: any) => {
    const jobObj = job.toObject ? job.toObject() : job;
    const providerInfo = jobObj.providerId && typeof jobObj.providerId === 'object' ? jobObj.providerId : null;
    const providerId = providerInfo ? (providerInfo._id || providerInfo.id) : (jobObj.providerId ? jobObj.providerId.toString() : null);

    return {
        ...jobObj,
        id: (jobObj._id || jobObj.id).toString(),
        customerId: jobObj.customerId ? jobObj.customerId.toString() : null,
        providerId: providerId ? providerId.toString() : null,
        providerInfo: providerInfo,
        currency: jobObj.pricingSnapshot?.currencyCode || 'USD'
    };
};

export const requestJob = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceCode, coordinates, address, isEmergency, isForSomeoneElse, recipientName, recipientPhone } = req.body;
    let { zoneId } = req.body;

    // 1. Determine which zone contains customer coordinates
    const resolvedZone = await zoneResolverService.resolveZoneForLocation(coordinates, req.user!.countryCode, true);

    if (!resolvedZone) {
        // If coordinate falls outside all active zones
        return res.status(403).json({ success: false, message: 'PieceJob is not yet available in this area.' });
    }

    zoneId = resolvedZone._id;

    // 2. Check if providers are online within that zone for the requested service
    const onlineProvidersInZone = await Provider.countDocuments({
        countryCode: req.user!.countryCode,
        isOnline: true,
        currentAvailabilityStatus: 'ONLINE',
        verificationStatus: 'APPROVED',
        servicesOffered: serviceCode,
        location: {
            $geoIntersects: {
                $geometry: resolvedZone.boundary
            }
        }
    });

    if (onlineProvidersInZone === 0) {
        return res.status(403).json({ success: false, message: 'No providers are currently online for this service in your area.' });
    }

    // PAGE 4 – PRICING & RULES INTEGRATION
    const pricingBreakdown = await pricingService.calculateJobPrice(
        serviceCode,
        req.user!.countryCode,
        zoneId,
        isEmergency
    );

    const job = new Job({
      customerId: req.user?.userId,
      serviceCode,
      countryCode: req.user?.countryCode,
      cityOrZoneId: zoneId,
      location: {
        type: 'Point',
        coordinates,
        address
      },
      bookingFee: pricingBreakdown.bookingFee,
      serviceFee: pricingBreakdown.totalAmount - pricingBreakdown.bookingFee,

      // Third Party
      isForSomeoneElse,
      recipientName,
      recipientPhone,

      // PRICING SNAPSHOT
      pricingSnapshot: {
          basePrice: pricingBreakdown.basePrice,
          hourlyPrice: pricingBreakdown.hourlyPrice,
          bookingFee: pricingBreakdown.bookingFee,
          taxPercentage: pricingBreakdown.taxPercentage,
          currencyCode: pricingBreakdown.currency,
          surcharges: pricingBreakdown.surcharges
      },

      isTestJob: await testUserService.isTestUser(req.user?.userId as string),
      status: JobStatus.DRAFT
    });

    await job.save();

    emitAdminUpdate('new_job_created', { jobId: job.id, countryCode: job.countryCode });

    res.status(201).json({
        success: true,
        data: sanitizeJobForMobile(job),
        pricing: pricingBreakdown
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const payBookingFee = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await Job.findById(jobId);

    if (!job || job.customerId.toString() !== req.user?.userId) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.paymentStatus === 'PAID') {
        return res.status(200).json({ success: true, message: 'Job already paid', data: sanitizeJobForMobile(job) });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Initialize Paystack Transaction
    const metadata = {
        jobId: job.id,
        customerId: user.id,
        serviceCode: job.serviceCode
    };

    const paymentRes = await paymentGatewayService.initializePayment(
        user.email,
        job.bookingFee,
        job.pricingSnapshot?.currencyCode || 'USD',
        metadata,
        job.countryCode
    );

    if (paymentRes.success) {
        job.paymentReference = paymentRes.reference;
        job.status = JobStatus.PAYMENT_PENDING;
        await job.save();

        return res.status(200).json({
            success: true,
            message: 'Payment initialized',
            data: {
                paymentUrl: paymentRes.paymentUrl,
                reference: paymentRes.reference,
                job: sanitizeJobForMobile(job)
            }
        });
    } else {
        return res.status(400).json({ success: false, message: paymentRes.message });
    }
  } catch (error: any) {
    logger.error(`JOB | PAYMENT_INIT_FAILED | Job: ${req.params.jobId} | Error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message || 'Payment initialization failed' });
  }
};

export const getAvailableJobs = async (req: AuthRequest, res: Response) => {
    try {
        const jobs = await Job.find({ status: JobStatus.BROADCASTED }).limit(50);
        res.status(200).json({
            success: true,
            data: jobs.map(j => sanitizeJobForMobile(j))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch available jobs', error });
    }
};

export const getActiveJob = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const job = await Job.findOne({
            $or: [
                { customerId: userId },
                { providerId: userId }
            ],
            status: { $in: [JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS] }
        }).sort({ updatedAt: -1 }).populate('providerId', 'firstName lastName ratingAvg jobsCompleted');

        if (!job) {
            return res.status(200).json({ success: true, data: null });
        }

        res.status(200).json({
            success: true,
            data: sanitizeJobForMobile(job)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch active job', error });
    }
};

export const getJobById = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const job = await Job.findById(jobId).populate('providerId', 'firstName lastName ratingAvg jobsCompleted');
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        res.status(200).json({
            success: true,
            data: sanitizeJobForMobile(job)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch job', error });
    }
};

export const acceptJob = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await jobService.acceptJob(jobId, req.user!.userId);
    emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.ACCEPTED, providerId: req.user!.userId });

    // Notify Customer via Socket (Job Room)
    emitJobUpdate(job.id, 'status_updated', { jobId: job.id, status: JobStatus.ACCEPTED });

    // Notify Customer via Socket (User Room - specific for acceptance transition)
    emitToUser(job.customerId.toString(), 'JOB_ACCEPTED', {
        jobId: job.id,
        status: JobStatus.ACCEPTED,
        providerId: req.user!.userId
    });

    // Notify Customer via FCM
    await notificationService.notifyUser(
        job.customerId.toString(),
        'Job Accepted',
        'A provider has accepted your request and is on the way.'
    );

    res.status(200).json({ success: true, message: 'Job accepted', data: sanitizeJobForMobile(job) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateJobStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const { status, providerCoordinates } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    // SECTION 4.1 & 5.1: Proximity Hardening for STARTED state
    if (status === JobStatus.STARTED) {
        if (!providerCoordinates) {
            return res.status(400).json({ success: false, message: 'Provider coordinates required to start job' });
        }

        const distance = calculateDistance(providerCoordinates, job.location.coordinates);
        if (distance > 20) {
            return res.status(403).json({
                success: false,
                message: `Proximity verification failed. You are ${Math.round(distance)}m away. Must be within 20m.`
            });
        }
        job.startedAt = new Date();
    }

    if (status === JobStatus.ARRIVED) {
        // PAGE 7: Increment Arrived on Time
        if (job.providerId) {
            await Provider.findOneAndUpdate(
                { userId: job.providerId },
                { $inc: { 'performance.arrivedOnTimeJobs': 1 } }
            );

            // Notify Customer
            await notificationService.notifyUser(
                job.customerId.toString(),
                'Provider Arrived',
                'Your provider has arrived at the location.'
            );
        }
    }

    if (status === JobStatus.COMPLETED) {
        job.completedAt = new Date();

        // PAGE 4.6 – COMPLETED JOB FINANCIALS (Using Snapshots)
        const totalAmount = (job.serviceFee || 0) + job.bookingFee;
        const commissionRate = job.commissionRateSnapshot || 15;

        await financialService.completeJobFinancials(
            job.id,
            job.providerId!.toString(),
            totalAmount,
            commissionRate,
            'USD', // Should come from settings/snapshot
            job.countryCode
        );

        // PAGE 7: Increment Completed Jobs
        const provider = await Provider.findOneAndUpdate(
            { userId: job.providerId },
            {
                $inc: { jobsCompleted: 1, 'performance.completedJobs': 1 },
                currentAvailabilityStatus: 'ONLINE'
            },
            { new: true }
        );

        if (provider) {
            emitAdminUpdate('provider_status_changed', {
                userId: job.providerId,
                isOnline: provider.isOnline,
                status: provider.currentAvailabilityStatus,
                timestamp: new Date()
            });
        }

        // Notify Customer
        await notificationService.notifyUser(
            job.customerId.toString(),
            'Job Completed',
            'Your job has been marked as completed. Please rate your provider.'
        );

        // PAGE 12: Fraud Analysis (Fake Completion)
        fraudService.analyzeJobCompletion(job.id);
    }

    job.status = status;
    await job.save();

    emitAdminUpdate('job_status_updated', { jobId: job.id, status });

    res.status(200).json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update job status', error });
  }
};

export const cancelJob = async (req: AuthRequest, res: Response) => {
    try {
      const { jobId } = req.params;
      const { reason } = req.body;

      const job = await Job.findById(jobId);
      if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

      const now = new Date();
      const userId = req.user?.userId;
      const role = req.user?.role;

      // SECTION 4: Cancellation Grace Windows
      if (job.status === JobStatus.ACCEPTED || job.status === JobStatus.ARRIVED) {
          const acceptedTime = job.acceptedAt ? job.acceptedAt.getTime() : job.updatedAt.getTime();
          const diffSeconds = (now.getTime() - acceptedTime) / 1000;

          if (role === 'PROVIDER' && diffSeconds > 90) {
              await AuditLog.create({
                  action: 'JOB_AUTO_CANCEL',
                  targetId: jobId,
                  targetCollection: 'Jobs',
                  newValue: { status: JobStatus.CANCELLED },
                  ipAddress: 'System'
              });
          }
      }

      job.status = JobStatus.CANCELLED;
      job.cancelledBy = new mongoose.Types.ObjectId(userId);
      job.cancellationReason = reason;
      await job.save();

      // Reset provider status to ONLINE if they are still isOnline
      if (job.providerId) {
          const provider = await Provider.findOneAndUpdate(
              { userId: job.providerId },
              { currentAvailabilityStatus: 'ONLINE' },
              { new: true }
          );

          if (provider) {
              emitAdminUpdate('provider_status_changed', {
                  userId: job.providerId,
                  isOnline: provider.isOnline,
                  status: provider.currentAvailabilityStatus,
                  timestamp: new Date()
              });
          }
      }

      // Notify other party
      const notifyTargetId = role === 'PROVIDER' ? job.customerId.toString() : job.providerId?.toString();
      if (notifyTargetId) {
          await notificationService.notifyUser(
              notifyTargetId,
              'Job Cancelled',
              `The job has been cancelled by the ${role?.toLowerCase()}.`
          );
      }

      emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.CANCELLED });

      res.status(200).json({ success: true, message: 'Job cancelled successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Cancellation failed', error });
    }
  };

export const rateJob = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const { rating, comment } = req.body;

        const job = await Job.findById(jobId);
        if (!job || job.status !== JobStatus.COMPLETED) {
            return res.status(400).json({ success: false, message: 'Invalid job state for rating' });
        }

        job.status = JobStatus.RATED;
        // In a full implementation, we'd have a Review model.
        // For now, we update the provider directly.
        if (job.providerId) {
            const provider = await Provider.findOne({ userId: job.providerId });
            if (provider) {
                const totalRating = (provider.ratingAvg * provider.jobsCompleted) + rating;
                provider.ratingAvg = totalRating / (provider.jobsCompleted + 1);
                // Note: jobsCompleted was incremented during status change to COMPLETED
                await provider.save();

                // PAGE 7: Trigger performance & tier evaluation
                await performanceService.recalculateProviderMetrics(provider._id.toString());
                await performanceService.evaluateTier(provider._id.toString());
            }
        }

        await job.save();
        res.status(200).json({ success: true, message: 'Thank you for your review' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Rating failed', error });
    }
};
