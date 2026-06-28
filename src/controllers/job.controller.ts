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

    // Forensic: Ensure status is mapped correctly for mobile
    if (jobObj.status === 'PROVIDER_ACCEPTED') {
        jobObj.status = 'ACCEPTED';
    }

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
            status: { $in: [JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.COMPLETED] }
        }).sort({ updatedAt: -1 })
          .populate('providerId', 'firstName lastName profilePicture')
          .populate('customerId', 'firstName lastName profilePicture');

        if (!job) {
            return res.status(200).json({ success: true, data: null });
        }

        // Logic to close "active" state if user has already rated a completed job
        const isCustomer = job.customerId.toString() === userId;
        if (job.status === JobStatus.COMPLETED) {
            if (isCustomer && job.customerRated) return res.status(200).json({ success: true, data: null });
            if (!isCustomer && job.providerRated) return res.status(200).json({ success: true, data: null });
        }

        let providerData = null;
        if (job.providerId) {
            const provider = await Provider.findOne({ userId: (job.providerId as any)._id || job.providerId });
            if (provider) {
                providerData = {
                    firstName: (job.providerId as any).firstName,
                    lastName: (job.providerId as any).lastName,
                    ratingAvg: provider.ratingAvg,
                    jobsCompleted: provider.jobsCompleted,
                    profilePicture: (job.providerId as any).profilePicture
                };
            }
        }

        const sanitized = sanitizeJobForMobile(job);
        if (providerData) sanitized.providerInfo = providerData;

        // Include customer info for provider
        if (req.user?.role === 'PROVIDER' && job.customerId) {
            sanitized.customerInfo = {
                firstName: (job.customerId as any).firstName,
                lastName: (job.customerId as any).lastName,
                profilePicture: (job.customerId as any).profilePicture
            };
        }

        res.status(200).json({
            success: true,
            data: sanitized
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch active job', error });
    }
};

export const getJobById = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const job = await Job.findById(jobId)
            .populate('providerId', 'firstName lastName profilePicture')
            .populate('customerId', 'firstName lastName profilePicture');
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        let providerData = null;
        if (job.providerId) {
            const provider = await Provider.findOne({ userId: (job.providerId as any)._id || job.providerId });
            if (provider) {
                providerData = {
                    firstName: (job.providerId as any).firstName,
                    lastName: (job.providerId as any).lastName,
                    phoneNumber: (job.providerId as any).phoneNumber,
                    ratingAvg: provider.ratingAvg,
                    jobsCompleted: provider.jobsCompleted,
                    profilePicture: (job.providerId as any).profilePicture
                };
            }
        }

        const sanitized = sanitizeJobForMobile(job);
        if (providerData) sanitized.providerInfo = providerData;

        // Include customer info for provider to see who they are rating/calling
        if (req.user?.role === 'PROVIDER' && job.customerId) {
            sanitized.customerInfo = {
                firstName: (job.customerId as any).firstName,
                lastName: (job.customerId as any).lastName,
                phoneNumber: (job.customerId as any).phoneNumber,
                profilePicture: (job.customerId as any).profilePicture
            };
        }

        res.status(200).json({
            success: true,
            data: sanitized
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch job', error });
    }
};

export const acceptJob = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await jobService.acceptJob(jobId, req.user!.userId);

    // Re-fetch with populated provider info for immediate mobile UI update
    const finalJob = await Job.findById(job.id).populate('providerId', 'firstName lastName');
    let providerData = null;
    if (finalJob?.providerId) {
        const provider = await Provider.findOne({ userId: (finalJob.providerId as any)._id });
        if (provider) {
            providerData = {
                firstName: (finalJob.providerId as any).firstName,
                lastName: (finalJob.providerId as any).lastName,
                ratingAvg: provider.ratingAvg,
                jobsCompleted: provider.jobsCompleted,
                profilePicture: (finalJob.providerId as any).profilePicture
            };
        }
    }

    const sanitized = sanitizeJobForMobile(finalJob || job);
    if (providerData) sanitized.providerInfo = providerData;

    const statusPayload = { jobId: job.id, status: JobStatus.ACCEPTED, providerInfo: providerData };

    // Notify Customer via Socket (User Room - specific for acceptance transition)
    console.log(`[FORENSIC] BACKEND_STATUS_CHANGED | Job: ${job.id} | New Status: ${JobStatus.ACCEPTED} | Target User: ${job.customerId}`);
    emitToUser(job.customerId.toString(), 'JOB_ACCEPTED', statusPayload);
    emitToUser(job.customerId.toString(), 'status_updated', statusPayload);

    // Notify Customer via Socket (Job Room)
    console.log(`[FORENSIC] SOCKET_STATUS_EMITTED | Room: job_${job.id} | Event: status_updated | Status: ${JobStatus.ACCEPTED}`);
    emitJobUpdate(job.id, 'status_updated', statusPayload);

    // Notify Customer via FCM
    await notificationService.notifyUser(
        job.customerId.toString(),
        'Job Accepted',
        'A provider has accepted your request and is on the way.'
    );

    res.status(200).json({ success: true, message: 'Job accepted', data: sanitized });
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
        if (distance > 50) { // Increased from 20 to 50 to match arrival detection radius
            return res.status(403).json({
                success: false,
                message: `Proximity verification failed. You are ${Math.round(distance)}m away. Must be within 50m.`
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

    console.log(`[FORENSIC] BACKEND_STATUS_CHANGED | Job: ${job.id} | New Status: ${status}`);
    logger.info(`JOB_STATE_CHANGED | Job: ${job.id} | New Status: ${status}`);
    emitAdminUpdate('job_status_updated', { jobId: job.id, status });

    const sanitized = sanitizeJobForMobile(job);
    const statusPayload = { jobId: job.id, status, providerInfo: sanitized.providerInfo };

    // 1. Notify participants via their private user rooms (Global Observer)
    emitToUser(job.customerId.toString(), 'status_updated', statusPayload);
    if (job.providerId) emitToUser(job.providerId.toString(), 'status_updated', statusPayload);

    // 2. Notify the specific job room (Tracking Screen)
    console.log(`[FORENSIC] SOCKET_STATUS_EMITTED | Room: job_${job.id} | Event: status_updated | Status: ${status}`);
    emitJobUpdate(job.id, 'status_updated', statusPayload);

    res.status(200).json({ success: true, data: sanitized });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update job status', error });
  }
};

export const cancelJob = async (req: AuthRequest, res: Response) => {
    try {
      const { jobId } = req.params;
      const { reason } = req.body;
      const userId = req.user?.userId;
      const role = req.user?.role;

      logger.info(`JOB_CANCEL_REQUEST_RECEIVED | Job: ${jobId} | User: ${userId} | Role: ${role}`);

      const job = await Job.findById(jobId);
      if (!job) {
          logger.warn(`JOB_CANCEL_ROUTE_NOT_FOUND | Job ${jobId} not found in DB`);
          return res.status(404).json({ success: false, message: 'Job not found' });
      }

      // Ownership and State Validation
      if (role === 'CUSTOMER' && job.customerId.toString() !== userId) {
          return res.status(403).json({ success: false, message: 'Unauthorized: You do not own this job' });
      }
      if (role === 'PROVIDER' && job.providerId?.toString() !== userId) {
          return res.status(403).json({ success: false, message: 'Unauthorized: You are not assigned to this job' });
      }

      if (job.status === JobStatus.COMPLETED) {
          return res.status(400).json({ success: false, message: 'Cannot cancel a completed job' });
      }

      logger.info(`JOB_CANCEL_VALIDATION_SUCCESS | Job: ${jobId}`);

      const now = new Date();

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
      job.cancellationReason = reason || 'Cancelled via App';
      await job.save();

      logger.info(`JOB_CANCEL_DATABASE_UPDATED | Job: ${jobId} | Status: CANCELLED`);

      // Stop every remaining broadcast wave
      try {
          const { clearJobBroadcasts } = require('../services/job-broadcast.queue');
          await clearJobBroadcasts(jobId);
          logger.info(`JOB_CANCEL_BROADCAST_STOPPED | Job: ${jobId}`);
      } catch (e) {
          logger.error(`Error clearing broadcasts for job ${jobId}: ${e}`);
      }

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
          logger.info(`JOB_CANCEL_PROVIDER_NOTIFIED | Target: ${notifyTargetId}`);
      }

      emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.CANCELLED });

      // Notify both via Socket
      emitJobUpdate(job.id, 'status_updated', { jobId: job.id, status: JobStatus.CANCELLED });

      logger.info(`JOB_CANCEL_COMPLETED | Job: ${jobId}`);
      res.status(200).json({ success: true, message: 'Job cancelled successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Cancellation failed', error });
    }
  };

import Review from '../models/Review';

export const rateJob = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const { rating, comment, tags } = req.body;
        const userId = req.user?.userId;
        const role = req.user?.role;

        const job = await Job.findById(jobId);
        if (!job || (job.status !== JobStatus.COMPLETED && job.status !== JobStatus.RATED)) {
            return res.status(400).json({ success: false, message: 'Invalid job state for rating' });
        }

        let reviewedUserId: string | undefined;

        if (role === 'CUSTOMER') {
            if (job.customerId.toString() !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });
            if (job.customerRated) return res.status(400).json({ success: false, message: 'You have already rated this job' });

            job.customerRated = true;
            reviewedUserId = job.providerId?.toString();

            if (job.providerId) {
                const provider = await Provider.findOne({ userId: job.providerId });
                if (provider) {
                    const totalRating = (provider.ratingAvg * provider.jobsCompleted) + rating;
                    provider.ratingAvg = totalRating / (provider.jobsCompleted + 1);
                    await provider.save();
                    await performanceService.recalculateProviderMetrics(provider._id.toString());
                }
            }
        } else if (role === 'PROVIDER') {
            if (job.providerId?.toString() !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });
            if (job.providerRated) return res.status(400).json({ success: false, message: 'You have already rated this job' });

            job.providerRated = true;
            reviewedUserId = job.customerId.toString();

            const customer = await User.findById(job.customerId);
            if (customer) {
                // Future: Update customer rating
            }
        }

        if (!reviewedUserId) {
            return res.status(400).json({ success: false, message: 'Review target not found' });
        }

        // Save formal Review record
        const review = new Review({
            jobId,
            reviewerId: userId,
            reviewedUserId,
            reviewerRole: role,
            rating,
            comment,
            tags
        });
        await review.save();

        if (job.customerRated && job.providerRated) {
            job.status = JobStatus.RATED;
        }

        await job.save();
        res.status(200).json({ success: true, message: 'Thank you for your review' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Rating failed', error });
    }
};
