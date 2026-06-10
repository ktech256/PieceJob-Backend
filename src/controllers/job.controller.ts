import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Job, { JobStatus } from '../models/Job';
import * as jobService from '../services/job.service';
import * as pricingService from '../services/pricing.service';
import * as financialService from '../services/financial.service';
import Provider from '../models/Provider';
import mongoose from 'mongoose';

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
    const { serviceCode, coordinates, address, zoneId } = req.body;

    // SECTION 17: Pricing Resolver Integration
    const pricingResult = await pricingService.resolveDynamicPricing(
        serviceCode,
        req.user!.countryCode,
        zoneId
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
      bookingFee: pricingResult.bookingFee,
      status: JobStatus.DRAFT
    });

    await job.save();
    res.status(201).json({ success: true, job, pricing: pricingResult });
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

    // SECTION 5.2: Double-Entry Ledger Integration
    await financialService.handleBookingFee(
        job.id,
        job.customerId.toString(),
        job.bookingFee,
        'USD', // Default currency
        job.countryCode
    );

    job.paymentStatus = 'PAID';
    job.status = JobStatus.BROADCASTED;
    await job.save();

    jobService.broadcastJob(job.id);

    res.status(200).json({ success: true, message: 'Payment successful, ledger updated', job });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Payment processing failed', error });
  }
};

export const acceptJob = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await jobService.acceptJob(jobId, req.user!.userId);
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

    if (status === JobStatus.COMPLETED) job.completedAt = new Date();

    job.status = status;
    await job.save();

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
      // Provider: 90s post-acceptance. Customer: 2m post-acceptance.
      if (job.status === JobStatus.ACCEPTED || job.status === JobStatus.ARRIVED) {
          const acceptedTime = job.acceptedAt ? job.acceptedAt.getTime() : job.updatedAt.getTime();
          const diffSeconds = (now.getTime() - acceptedTime) / 1000;

          if (role === 'PROVIDER' && diffSeconds > 90) {
              // Apply Penalty Logic
              console.log(`Provider ${userId} cancelled after 90s grace window.`);
          } else if (role === 'CUSTOMER' && diffSeconds > 120) {
              // Apply Penalty Logic
              console.log(`Customer ${userId} cancelled after 2m grace window.`);
          }
      }

      job.status = JobStatus.CANCELLED;
      job.cancelledBy = new mongoose.Types.ObjectId(userId);
      job.cancellationReason = reason;
      await job.save();

      res.status(200).json({ success: true, message: 'Job cancelled successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Cancellation failed', error });
    }
  };
