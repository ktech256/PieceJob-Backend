import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Job, { JobStatus } from '../models/Job';
import * as jobService from '../services/job.service';
import * as pricingService from '../services/pricing.service';
import * as financialService from '../services/financial.service';
import Provider from '../models/Provider';
import AuditLog from '../models/AuditLog';
import mongoose from 'mongoose';
import { emitAdminUpdate } from '../socket/socket.service';

import * as performanceService from '../services/provider-performance.service';
import * as zoneResolverService from '../services/zone-resolver.service';
import * as fraudService from '../services/fraud.service';
import * as notificationService from '../services/notification.service';
import * as testUserService from '../services/test-user.service';

function calculateDistance(c1: number[], c2: number[]) {
  const R = 6371e3; // meters
  const lat1 = c1[1] * Math.PI/180;
  const lat2 = c2[1] * Math.PI/180;
  const dLat = (c2[1]-c1[1]) * Math.PI/180;
  const dLon = (c2[0]-c1[0]) * Math.PI/180;

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1) * Math.cos(lat2) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // in meters
}

export const requestJob = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceCode, coordinates, address, isEmergency, isForSomeoneElse, recipientName, recipientPhone } = req.body;
    let { zoneId } = req.body;

    // Automatic Zone Resolution (with availability check)
    if (!zoneId && coordinates) {
        const resolvedZone = await zoneResolverService.resolveZoneForLocation(coordinates, req.user!.countryCode, true);
        if (!resolvedZone) {
            return res.status(403).json({ success: false, message: 'PieceJob is not yet available in this area.' });
        }
        zoneId = resolvedZone._id;
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
          surcharges: pricingBreakdown.surcharges
      },

      isTestJob: await testUserService.isTestUser(req.user?.userId as string),
      status: JobStatus.DRAFT
    });

    await job.save();

    emitAdminUpdate('new_job_created', { jobId: job.id, countryCode: job.countryCode });

    res.status(201).json({ success: true, job, pricing: pricingBreakdown });
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
        return res.status(200).json({ success: true, message: 'Job already paid', job });
    }

    // SECTION 5.2: Double-Entry Ledger Integration
    await financialService.handleBookingFee(
        job.id,
        job.customerId.toString(),
        job.bookingFee,
        'USD', // Default currency
        job.countryCode
    );

    job.paymentStatus = 'PAID';
    job.status = JobStatus.BROADCASTED; // Start broadcasting immediately
    await job.save();

    jobService.broadcastJob(job.id);
    emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });

    res.status(200).json({ success: true, message: 'Payment successful, ledger updated', job });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Payment processing failed', error });
  }
};

export const getJobById = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const job = await Job.findById(jobId).populate('providerId', 'firstName lastName ratingAvg jobsCompleted');
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        res.status(200).json({ success: true, data: job });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch job', error });
    }
};

export const acceptJob = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await jobService.acceptJob(jobId, req.user!.userId);
    emitAdminUpdate('job_status_updated', { jobId: job.id, status: JobStatus.ACCEPTED, providerId: req.user!.userId });

    // Notify Customer
    await notificationService.notifyUser(
        job.customerId.toString(),
        'Job Accepted',
        'A provider has accepted your request and is on the way.'
    );

    res.status(200).json({ success: true, message: 'Job accepted', job });
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
