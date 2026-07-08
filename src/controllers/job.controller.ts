import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import Service from '../models/Service';
import PriceProposal from '../models/PriceProposal';
import * as jobService from '../services/job.service';
import * as pricingService from '../services/pricing.service';
import * as financialService from '../services/financial.service';
import * as storageService from '../services/storage.service';
import Provider from '../models/Provider';
import ChatMessage from '../models/Chat';
import AuditLog from '../models/AuditLog';
import mongoose from 'mongoose';
import { emitAdminUpdate, emitJobUpdate, emitToUser, emitToWorkspace, syncJobStatus } from '../socket/socket.service';

import * as performanceService from '../services/provider-performance.service';
import * as zoneResolverService from '../services/zone-resolver.service';
import * as fraudService from '../services/fraud.service';
import * as notificationService from '../services/notification.service';
import * as testUserService from '../services/test-user.service';
import * as paymentGatewayService from '../services/payment-gateway.service';
import * as userContextService from '../services/user-context.service';
import * as auditService from '../services/audit.service';
import { logger } from '../utils/logger';
import { calculateDistance } from '../utils/location';

const sanitizeJobForMobile = async (job: any) => {
    const jobObj = job.toObject ? job.toObject() : job;

    // Populated objects have a firstName field. ObjectIds do not.
    let providerInfo = (jobObj.providerId && typeof jobObj.providerId === 'object' && 'firstName' in jobObj.providerId) ? jobObj.providerId : null;
    const providerId = providerInfo ? (providerInfo._id || providerInfo.id) : (jobObj.providerId ? jobObj.providerId.toString() : null);

    let customerInfo = (jobObj.customerId && typeof jobObj.customerId === 'object' && 'firstName' in jobObj.customerId) ? jobObj.customerId : null;
    const customerId = customerInfo ? (customerInfo._id || customerInfo.id) : (jobObj.customerId ? jobObj.customerId.toString() : null);

    // Map profilePhoto to profilePicture for Android DTO compatibility
    if (providerInfo && providerInfo.profilePhoto) providerInfo.profilePicture = providerInfo.profilePhoto;
    if (customerInfo && customerInfo.profilePhoto) customerInfo.profilePicture = customerInfo.profilePhoto;

    const sanitized = {
        ...jobObj,
        id: (jobObj._id || jobObj.id).toString(),
        customerId: customerId ? customerId.toString() : null,
        providerId: providerId ? providerId.toString() : null,
        providerInfo: providerInfo,
        customerInfo: customerInfo,
        serviceName: jobObj.serviceName || jobObj.serviceCode, // Fallback for older jobs
        currency: jobObj.pricingSnapshot?.currencyCode || 'USD'
    };

    // Enrich taskPhotos with signed URLs
    if (sanitized.taskPhotos && Array.isArray(sanitized.taskPhotos)) {
        sanitized.taskPhotos = await Promise.all(sanitized.taskPhotos.map(async (path: string) => {
            try {
                return await storageService.getSignedUrl(path);
            } catch (err) {
                logger.error(`Failed to sign URL for ${path}: ${err}`);
                return path; // Fallback to raw path if signing fails
            }
        }));
    }

    // PHASE 3 & 5: Privacy Hardening & Dispatch Control
    // Hide exact address until provider is dispatched (EN_ROUTE)
    // IMPORTANT: Terminal statuses should NOT be obscured (already completed)
    const unlockedStatuses = [JobStatus.EN_ROUTE, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.IN_PROGRESS, JobStatus.COMPLETED, JobStatus.RATED, JobStatus.CLOSED];
    const isUnlocked = unlockedStatuses.includes(jobObj.status);

    if (!isUnlocked) {
        const rawAddress = sanitized.location?.address || sanitized.address || '';
        const addressParts = rawAddress.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0);

        let obscured = 'Nearby Location';
        if (addressParts.length >= 3) {
            obscured = `${addressParts[1]}, ${addressParts[2]}`;
        } else if (addressParts.length >= 1) {
            // If it's a short address, it might just be the street name. Hide it completely if it contains numbers.
            if (/\d/.test(addressParts[0])) {
                obscured = 'Nearby Street';
            } else {
                obscured = addressParts[0];
            }
        }

        sanitized.address = obscured;
        if (sanitized.location) {
            sanitized.location.address = obscured;
            sanitized.location.coordinates = [0, 0];
        }
        if (sanitized.pickupLocation) {
            sanitized.pickupLocation.address = obscured;
            sanitized.pickupLocation.coordinates = [0, 0];
        }
    }

    return sanitized;
};

/**
 * Calculates the current phase of the negotiation/dispatch workflow.
 * This is the SOURCE OF TRUTH for the mobile apps.
 */
export const calculateNegotiationPhase = async (job: any) => {
    const status = job.status;

    // 1. Fetch Service config if flags are missing from the job (legacy or fresh accepted)
    let photoRequired = job.photoSharingRequired;
    let negRequired = job.priceNegotiationRequired;

    if (photoRequired === undefined || negRequired === undefined) {
        const service = await mongoose.model('Service').findOne({
            code: job.serviceCode,
            countryCode: { $in: [job.countryCode, 'GLOBAL'] }
        }).sort({ countryCode: -1 });

        // Forensic Fix: Ensure we don't accidentally default to false if service lookup fails
        // but also ensure we don't crash. We use the job's existing flags if available.
        photoRequired = service?.photoSharingRequired ?? (job.photoSharingRequired || false);
        negRequired = service?.priceNegotiationRequired ?? (job.priceNegotiationRequired || false);

        // Update the object in memory for this calculation
        job.photoSharingRequired = photoRequired;
        job.priceNegotiationRequired = negRequired;
    }

    // TERMINAL & DISPATCH PHASES (HIGHEST PRIORITY)
    if (['EN_ROUTE', 'ARRIVED', 'STARTED', 'IN_PROGRESS'].includes(status)) {
        return 'DISPATCHED';
    }
    if (['COMPLETED', 'RATED', 'CLOSED'].includes(status)) {
        return 'COMPLETED';
    }
    if (status === 'CANCELLED') {
        return 'CANCELLED';
    }

    if (['DRAFT', 'REQUEST_CREATED', 'BROADCASTED', 'BROADCASTING', 'PAYMENT_PENDING', 'BOOKING_FEE_PAID'].includes(status)) {
        return 'NEUTRAL';
    }

    // NEGOTIATION WORKFLOW (Status is PROVIDER_ACCEPTED or ACCEPTED)

    // A. Photo Phase
    if (photoRequired && !job.taskPhotosSeen) {
        if (!job.taskPhotosRequested) return 'PHOTO_REQUEST';
        if (!job.taskPhotos || job.taskPhotos.length === 0) return 'WAITING_FOR_PHOTOS';
        return 'PHOTOS_UPLOADED';
    }

    // B. Price Phase
    if (negRequired && job.priceStatus !== 'ACCEPTED') {
        if (job.activeProposal && job.activeProposal.status === 'PENDING') {
            const senderId = job.activeProposal.senderId?._id || job.activeProposal.senderId;
            if (senderId.toString() === job.customerId.toString()) {
                return 'WAITING_FOR_PROVIDER';
            } else {
                return 'WAITING_FOR_CUSTOMER';
            }
        }
        return 'PRICE_PROPOSAL';
    }

    // C. Ready for Dispatch
    return 'PRICE_ACCEPTED';
};

/**
 * Enriches a sanitized job with active negotiation data if present.
 */
export const enrichWithNegotiation = async (sanitizedJob: any) => {
    // 1. Fetch active proposal
    const activeProposal = await PriceProposal.findOne({
        jobId: sanitizedJob.id,
        status: 'PENDING'
    }).sort({ createdAt: -1 });

    if (activeProposal) {
        sanitizedJob.activeProposal = activeProposal;
    }

    // 2. Calculate the source-of-truth phase
    sanitizedJob.currentNegotiationPhase = await calculateNegotiationPhase(sanitizedJob);

    return sanitizedJob;
};

export const requestJob = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceCode, coordinates, address, pickupCoordinates, pickupAddress, isEmergency, isForSomeoneElse, recipientName, recipientPhone } = req.body;
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

    const service = await Service.findOne({
        code: serviceCode,
        countryCode: { $in: [req.user!.countryCode, 'GLOBAL'] }
    }).sort({ countryCode: -1 });
    if (!service) {
        return res.status(404).json({ success: false, message: 'Service not found.' });
    }

    const job = new Job({
      customerId: req.user?.userId,
      serviceCode,
      serviceName: service.name,
      countryCode: req.user?.countryCode,
      cityOrZoneId: zoneId,
      location: {
        type: 'Point',
        coordinates,
        address
      },
      pickupLocation: pickupCoordinates ? {
        type: 'Point',
        coordinates: pickupCoordinates,
        address: pickupAddress
      } : {
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

    // Auto-save location for reuse (Issue 3)
    await userContextService.autoSaveLocation(req.user!.userId, address, coordinates);

    emitAdminUpdate('new_job_created', { jobId: job.id, countryCode: job.countryCode });

    res.status(201).json({
        success: true,
        data: await sanitizeJobForMobile(job),
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
        return res.status(200).json({ success: true, message: 'Job already paid', data: await sanitizeJobForMobile(job) });
    }

    // 2. Handle Free Bookings (Zero Booking Fee)
    if (job.bookingFee === 0) {
        job.paymentStatus = 'PAID';
        job.status = JobStatus.BROADCASTED;
        job.paymentReference = 'FREE_BOOKING_' + Date.now();
        await job.save();

        await jobService.broadcastJob(job.id);
        emitJobUpdate(job.id, 'status_updated', { jobId: job.id, status: JobStatus.BROADCASTED });

        return res.status(200).json({
            success: true,
            message: 'Free booking confirmed',
            data: {
                paymentUrl: null,
                reference: job.paymentReference,
                job: await sanitizeJobForMobile(job)
            }
        });
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
                job: await sanitizeJobForMobile(job)
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
        const countryCode = req.user?.countryCode;
        const query: any = { status: JobStatus.BROADCASTED };

        if (countryCode) {
            query.countryCode = countryCode;
        }

        const jobs = await Job.find(query)
            .sort({ createdAt: -1 })
            .populate('customerId', 'firstName lastName profilePhoto phoneNumber')
            .limit(50);

        res.status(200).json({
            success: true,
            data: await Promise.all(jobs.map(async j => {
                const sanitized = await sanitizeJobForMobile(j);

                // Privacy Hardening for unaccepted jobs
                const rawAddress = sanitized.location?.address || sanitized.address || '';
                const addressParts = rawAddress.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0);

                let obscured = 'Nearby Location';
                if (addressParts.length >= 3) {
                    obscured = `${addressParts[1]}, ${addressParts[2]}`;
                } else if (addressParts.length >= 1) {
                    obscured = addressParts[0];
                }

                sanitized.address = obscured;
                if (sanitized.location) sanitized.location.address = obscured;

                return sanitized;
            }))
        });
    } catch (error) {
        logger.error(`JOB | GET_AVAILABLE_JOBS_FAILED | Error: ${error}`);
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
            status: { $in: [
                JobStatus.ACCEPTED,
                JobStatus.PROVIDER_ACCEPTED,
                JobStatus.ARRIVED,
                JobStatus.STARTED,
                JobStatus.EN_ROUTE,
                JobStatus.IN_PROGRESS,
                JobStatus.COMPLETED
            ] }
        }).sort({ updatedAt: -1 })
          .populate('providerId', 'firstName lastName profilePhoto phoneNumber')
          .populate('customerId', 'firstName lastName profilePhoto phoneNumber');

        if (!job) {
            return res.status(200).json({ success: true, data: null });
        }

        // Logic to close "active" state if user has already rated or dismissed a completed job
        const isCustomer = job.customerId.toString() === userId;
        if (job.status === JobStatus.COMPLETED) {
            // 1. Check if already rated or dismissed
            if (isCustomer && (job.customerRated || job.customerRatingDismissed)) return res.status(200).json({ success: true, data: null });
            if (!isCustomer && (job.providerRated || job.providerRatingDismissed)) return res.status(200).json({ success: true, data: null });

            // 2. NEW RATING POLICY: Expiry window (24 hours)
            const RATING_WINDOW_HOURS = 24;
            const completionTime = job.completedAt || job.updatedAt;
            const hoursSinceCompletion = (Date.now() - completionTime.getTime()) / (1000 * 60 * 60);

            if (hoursSinceCompletion > RATING_WINDOW_HOURS) {
                logger.info(`[FORENSIC] RATING_EXPIRED | Job: ${job._id} | Hours: ${hoursSinceCompletion.toFixed(1)}`);
                // Silently dismiss for the requesting user
                if (isCustomer) job.customerRatingDismissed = true;
                else job.providerRatingDismissed = true;
                await job.save();
                return res.status(200).json({ success: true, data: null });
            }
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
                    profilePicture: (job.providerId as any).profilePhoto
                };
            }
        }

        const sanitized = await sanitizeJobForMobile(job);
        if (providerData) sanitized.providerInfo = providerData;

        // Include customer info for provider to see who they are rating
        if (req.user?.role === 'PROVIDER' && job.customerId) {
            sanitized.customerInfo = {
                firstName: (job.customerId as any).firstName,
                lastName: (job.customerId as any).lastName,
                profilePicture: (job.customerId as any).profilePhoto
            };
        }

        res.status(200).json({
            success: true,
            data: await enrichWithNegotiation(sanitized)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch active job', error });
    }
};

export const getMyJobs = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const role = req.user?.role;
        const { status } = req.query;

        if (!userId) return res.status(401).json({ success: false, message: 'User ID missing in token' });

        // 1. BASE QUERY CONSTRUCTION (Forensic: Ensure ObjectId for robust matching)
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const query: any = role === 'PROVIDER' ? { providerId: userObjectId } : { customerId: userObjectId };

        // 1.1 WORKSPACE ISOLATION (Forensic: Ensure users only see jobs in their registered workspace)
        if (req.user?.countryCode && role !== 'SUPER_ADMIN') {
            query.countryCode = req.user.countryCode;
        }

        // 2. STATUS MAPPING (Forensic Audit & Alignment with Step 3)
        if (status) {
            if (status === 'ACTIVE') {
                if (role === 'PROVIDER') {
                    // Providers see jobs they are currently assigned to and active
                    query.status = { $in: [
                        JobStatus.ACCEPTED,
                        JobStatus.PROVIDER_ACCEPTED,
                        JobStatus.EN_ROUTE,
                        JobStatus.ARRIVED,
                        JobStatus.STARTED,
                        JobStatus.IN_PROGRESS,
                        JobStatus.COMPLETED // COMPLETED but not yet rated can be considered active for provider UI
                    ] };
                } else {
                    // Customers see their request lifecycle until it's archived/closed
                    query.status = { $in: [
                        JobStatus.DRAFT,
                        JobStatus.REQUEST_CREATED,
                        JobStatus.PAYMENT_PENDING,
                        JobStatus.BOOKING_FEE_PAID,
                        JobStatus.BROADCASTING,
                        JobStatus.BROADCASTED,
                        JobStatus.ACCEPTED,
                        JobStatus.PROVIDER_ACCEPTED,
                        JobStatus.EN_ROUTE,
                        JobStatus.ARRIVED,
                        JobStatus.STARTED,
                        JobStatus.IN_PROGRESS,
                        JobStatus.COMPLETED
                    ] };
                }
            } else if (status === 'COMPLETED') {
                query.status = { $in: [JobStatus.COMPLETED, JobStatus.RATED, JobStatus.CLOSED] };
            } else {
                query.status = status;
            }
        }

        logger.debug(`[FORENSIC] getMyJobs | User: ${userId} | Role: ${role} | Status: ${status} | Query: ${JSON.stringify(query)}`);

        // 3. EXECUTION & POPULATION
        const jobs = await Job.find(query)
            .sort({ createdAt: -1 })
            .populate('customerId', 'firstName lastName profilePhoto phoneNumber')
            .populate('providerId', 'firstName lastName profilePhoto phoneNumber')
            .limit(100);

        logger.debug(`[FORENSIC] getMyJobs | Found: ${jobs.length} jobs`);

        // 4. BATCH ENRICHMENT (Performance Optimization)
        const providerIds = jobs.map(j => j.providerId).filter(id => id != null);
        const providers = await Provider.find({ userId: { $in: providerIds } });
        const providerMap = new Map(providers.map(p => [p.userId.toString(), p]));

        // 5. SERIALIZATION
        const formatted = await Promise.all(jobs.map(async (j) => {
            const sanitized = await sanitizeJobForMobile(j);

            // Enrich provider info with metrics
            if (sanitized.providerId) {
                const provider = providerMap.get(sanitized.providerId.toString());
                if (sanitized.providerInfo) {
                    sanitized.providerInfo.ratingAvg = provider?.ratingAvg || 0;
                    sanitized.providerInfo.jobsCompleted = provider?.jobsCompleted || 0;
                }
            }

            return await enrichWithNegotiation(sanitized);
        }));

        res.status(200).json({ success: true, data: formatted });
    } catch (error: any) {
        logger.error(`JOB | GET_MY_JOBS_FAILED | User: ${req.user?.userId} | Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch jobs history', error: error.message });
    }
};

export const getJobById = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const job = await Job.findById(jobId)
            .populate('providerId', 'firstName lastName profilePhoto phoneNumber')
            .populate('customerId', 'firstName lastName profilePhoto phoneNumber');
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
                    profilePicture: (job.providerId as any).profilePhoto
                };
            }
        }

        const sanitized = await sanitizeJobForMobile(job);
        if (providerData) sanitized.providerInfo = providerData;

        // Include customer info for provider to see who they are rating/calling
        if (req.user?.role === 'PROVIDER' && job.customerId) {
            sanitized.customerInfo = {
                firstName: (job.customerId as any).firstName,
                lastName: (job.customerId as any).lastName,
                phoneNumber: (job.customerId as any).phoneNumber,
                profilePicture: (job.customerId as any).profilePhoto
            };
        }

        res.status(200).json({
            success: true,
            data: await enrichWithNegotiation(sanitized)
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
    const finalJob = await Job.findById(job.id).populate('providerId', 'firstName lastName profilePhoto phoneNumber');
    let providerData = null;
    if (finalJob?.providerId) {
        const provider = await Provider.findOne({ userId: (finalJob.providerId as any)._id });
        if (provider) {
            providerData = {
                id: (finalJob.providerId as any)._id.toString(),
                firstName: (finalJob.providerId as any).firstName,
                lastName: (finalJob.providerId as any).lastName,
                ratingAvg: provider.ratingAvg,
                jobsCompleted: provider.jobsCompleted,
                profilePicture: (finalJob.providerId as any).profilePhoto
            };
        }
    }

    const sanitized = await sanitizeJobForMobile(finalJob || job);
    if (providerData) sanitized.providerInfo = providerData;

    // Unified Real-Time Sync
    syncJobStatus(finalJob || job, 'status_updated', { providerInfo: providerData });

    // Notify Customer via FCM
    const notificationMsg = job.status === JobStatus.PROVIDER_ACCEPTED
        ? 'A provider has accepted your request. Negotiation is required.'
        : 'A provider has accepted your request and is on the way.';

    await notificationService.notifyUser(
        job.customerId.toString(),
        'Job Accepted',
        notificationMsg
    );

    res.status(200).json({
        success: true,
        message: 'Job accepted',
        data: await enrichWithNegotiation(sanitized)
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateJobStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const { status, providerCoordinates, distanceTravelled } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const terminalStatuses = [JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.RATED];
    if (terminalStatuses.includes(job.status)) {
        if (status === job.status || (status === JobStatus.COMPLETED && (job.status === JobStatus.RATED || job.status === JobStatus.CLOSED))) {
            return res.status(200).json({
                success: true,
                message: `Job already in ${job.status} state`,
                data: await sanitizeJobForMobile(job)
            });
        }
        return res.status(400).json({ success: false, message: `Cannot update status of a ${job.status} job` });
    }

    // PHASE 3 Hardening: Block progression from PROVIDER_ACCEPTED/ACCEPTED via status update
    const lockedStatuses = [JobStatus.PROVIDER_ACCEPTED, JobStatus.ACCEPTED];
    if (lockedStatuses.includes(job.status) && status !== JobStatus.CANCELLED) {
        return res.status(403).json({
            success: false,
            message: 'Job is locked in negotiation phase. Complete negotiations and confirm dispatch to proceed.'
        });
    }

    if (distanceTravelled) job.distanceTravelled = distanceTravelled;

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

    let updatedJob;
    if (status === JobStatus.COMPLETED) {
        try {
            updatedJob = await jobService.completeJob(job.id);
        } catch (jobErr: any) {
            logger.error(`JOB | COMPLETE_FAILED | Job: ${job.id} | Error: ${jobErr.message}`);
            return res.status(400).json({ success: false, message: jobErr.message || 'Job completion protocol failed.' });
        }
    } else {
        job.status = status;
        updatedJob = await job.save();

        console.log(`[FORENSIC] BACKEND_STATUS_CHANGED | Job: ${job.id} | New Status: ${status}`);
        logger.info(`JOB_STATE_CHANGED | Job: ${job.id} | New Status: ${status}`);

        // Unified Real-Time Sync
        syncJobStatus(updatedJob);

        // Notify Customer via Push for specific statuses
        if (status === JobStatus.ARRIVED) {
            await notificationService.notifyUser(
                job.customerId.toString(),
                'Provider Arrived',
                'Your provider has arrived at the location.'
            );
        }
    }

    const sanitized = await sanitizeJobForMobile(updatedJob || job);

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

      const terminalStatuses = [JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.RATED];
      if (terminalStatuses.includes(job.status)) {
          return res.status(400).json({ success: false, message: `Cannot cancel a ${job.status} job` });
      }

      logger.info(`JOB_CANCEL_VALIDATION_SUCCESS | Job: ${jobId}`);

      const now = new Date();

      // SECTION 4: Cancellation Grace Windows
      if (job.status === JobStatus.ACCEPTED || job.status === JobStatus.ARRIVED) {
          const acceptedTime = job.acceptedAt ? job.acceptedAt.getTime() : job.updatedAt.getTime();
          const diffSeconds = (now.getTime() - acceptedTime) / 1000;

          if (role === 'PROVIDER' && diffSeconds > 90) {
              await auditService.logAdminAction({
                  countryCode: job.countryCode,
                  adminId: 'SYSTEM',
                  adminRole: 'SYSTEM',
                  action: 'JOB_AUTO_CANCEL',
                  entityType: 'Jobs',
                  entityId: jobId,
                  afterState: { status: JobStatus.CANCELLED },
                  ipAddress: 'System',
                  systemSource: 'API'
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

      // Reset provider status based on their isOnline preference
      if (job.providerId) {
          const provider = await Provider.findOne({ userId: job.providerId });
          if (provider) {
              provider.currentAvailabilityStatus = provider.isOnline ? 'ONLINE' : 'OFFLINE';
              await provider.save();

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
      emitToWorkspace(job.countryCode, 'status_updated', { jobId: job.id, status: JobStatus.CANCELLED });

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

export const dismissRating = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const userId = req.user?.userId;
        const role = req.user?.role;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (role === 'CUSTOMER') {
            if (job.customerId.toString() !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });
            job.customerRatingDismissed = true;
        } else if (role === 'PROVIDER') {
            if (job.providerId?.toString() !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });
            job.providerRatingDismissed = true;
        }

        await job.save();
        res.status(200).json({ success: true, message: 'Rating request dismissed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Dismissal failed', error });
    }
};

export const uploadTaskPhotos = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const { photos } = req.body; // Array of URLs
        const customerId = req.user?.userId;

        if (!photos || !Array.isArray(photos) || photos.length > 4) {
            return res.status(400).json({ success: false, message: 'Maximum 4 photos allowed' });
        }

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (job.customerId.toString() !== customerId) {
            return res.status(403).json({ success: false, message: 'Only the customer can upload task photos' });
        }

        job.taskPhotos = photos;
        job.negotiationTimeline.push({
            event: 'PHOTOS_UPLOADED',
            timestamp: new Date(),
            metadata: { count: photos.length }
        });
        await job.save();

        // Send a structured message in chat
        const chatMsg = new ChatMessage({
            jobId,
            senderId: customerId,
            receiverId: job.providerId,
            text: 'Customer uploaded task photos.',
            mediaUrl: photos[0], // Show the first one as preview
            mediaType: 'IMAGE',
            metadata: { type: 'PHOTO_UPLOAD', allPhotos: photos }
        });
        await chatMsg.save();

        const populated = await ChatMessage.findById(chatMsg._id).populate('senderId', 'firstName lastName role profilePhoto');
        const data: any = populated?.toObject();
        if (data) {
            data.id = data._id?.toString();
            data.jobId = data.jobId?.toString();
            if (data.senderId && typeof data.senderId === 'object') {
                data.senderId._id = data.senderId._id?.toString();
                data.senderId.profilePicture = await storageService.getSignedUrl(data.senderId.profilePhoto);
            }
            if (data.receiverId) data.receiverId = data.receiverId.toString();
        }

        // Enrich metadata photos with signed URLs for socket emit
        if (data && data.metadata && data.metadata.type === 'PHOTO_UPLOAD' && Array.isArray(data.metadata.allPhotos)) {
            data.metadata.allPhotos = await Promise.all(data.metadata.allPhotos.map(async (path: string) => {
                return await storageService.getSignedUrl(path);
            }));
            if (data.mediaUrl) {
                data.mediaUrl = await storageService.getSignedUrl(data.mediaUrl);
            }
        }

        emitJobUpdate(jobId, 'new_message', data);

        if (job.providerId) {
            await notificationService.notifyUser(
                job.providerId.toString(),
                'Task Photos Received',
                'The customer has uploaded the requested task photos.',
                { type: 'PHOTO_UPLOAD', jobId: jobId.toString() }
            );
        }

        res.status(200).json({ success: true, message: 'Photos uploaded successfully', photos: job.taskPhotos });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to upload photos', error });
    }
};

export const requestTaskPhotos = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const providerId = req.user?.userId;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (job.providerId?.toString() !== providerId) {
            return res.status(403).json({ success: false, message: 'Only the assigned provider can request photos' });
        }

        job.taskPhotosRequested = true;
        job.taskPhotosRequestedAt = new Date();
        job.negotiationTimeline.push({
            event: 'PHOTOS_REQUESTED',
            timestamp: new Date()
        });
        await job.save();

        // Send a structured message in chat
        const chatMsg = new ChatMessage({
            jobId,
            senderId: providerId,
            receiverId: job.customerId,
            text: 'Provider requested photos for this task.',
            metadata: { type: 'PHOTO_REQUEST' }
        });
        await chatMsg.save();

        const populated = await ChatMessage.findById(chatMsg._id).populate('senderId', 'firstName lastName role profilePhoto');
        const data: any = populated?.toObject();
        if (data) {
            data.id = data._id?.toString();
            data.jobId = data.jobId?.toString();
            if (data.senderId && typeof data.senderId === 'object') {
                data.senderId._id = data.senderId._id?.toString();
                data.senderId.profilePicture = await storageService.getSignedUrl(data.senderId.profilePhoto);
            }
            if (data.receiverId) data.receiverId = data.receiverId.toString();
        }

        // Enrich metadata photos with signed URLs for socket emit
        if (data && data.metadata && data.metadata.type === 'PHOTO_UPLOAD' && Array.isArray(data.metadata.allPhotos)) {
            data.metadata.allPhotos = await Promise.all(data.metadata.allPhotos.map(async (path: string) => {
                return await storageService.getSignedUrl(path);
            }));
            if (data.mediaUrl) {
                data.mediaUrl = await storageService.getSignedUrl(data.mediaUrl);
            }
        }

        emitJobUpdate(jobId, 'new_message', data);

        await notificationService.notifyUser(
            job.customerId.toString(),
            'Photos Requested',
            'Your provider has requested photos of the task to provide a better estimate.',
            { type: 'PHOTO_REQUEST', jobId: jobId.toString() }
        );

        res.status(200).json({ success: true, message: 'Photos requested successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to request photos', error });
    }
};

export const markTaskPhotosSeen = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const providerId = req.user?.userId;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (job.providerId?.toString() !== providerId) {
            return res.status(403).json({ success: false, message: 'Only the assigned provider can mark photos as seen' });
        }

        job.taskPhotosSeen = true;
        job.negotiationTimeline.push({
            event: 'PHOTOS_REVIEWED',
            timestamp: new Date()
        });
        await job.save();

        // Send a structured message in chat
        const chatMsg = new ChatMessage({
            jobId,
            senderId: providerId,
            receiverId: job.customerId,
            text: 'Provider has viewed the task photos.',
            metadata: { type: 'PHOTOS_SEEN' }
        });
        await chatMsg.save();

        const populated = await ChatMessage.findById(chatMsg._id).populate('senderId', 'firstName lastName role profilePhoto');
        const data: any = populated?.toObject();
        if (data) {
            data.id = data._id?.toString();
            data.jobId = data.jobId?.toString();
            if (data.senderId && typeof data.senderId === 'object') {
                data.senderId._id = data.senderId._id?.toString();
                data.senderId.profilePicture = await storageService.getSignedUrl(data.senderId.profilePhoto);
            }
            if (data.receiverId) data.receiverId = data.receiverId.toString();
        }

        // Enrich metadata photos with signed URLs for socket emit
        if (data && data.metadata && data.metadata.type === 'PHOTO_UPLOAD' && Array.isArray(data.metadata.allPhotos)) {
            data.metadata.allPhotos = await Promise.all(data.metadata.allPhotos.map(async (path: string) => {
                return await storageService.getSignedUrl(path);
            }));
            if (data.mediaUrl) {
                data.mediaUrl = await storageService.getSignedUrl(data.mediaUrl);
            }
        }

        emitJobUpdate(jobId, 'new_message', data);

        res.status(200).json({ success: true, message: 'Photos marked as seen' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to mark photos seen', error });
    }
};

export const confirmDispatch = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const providerId = req.user?.userId;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (job.providerId?.toString() !== providerId) {
            return res.status(403).json({ success: false, message: 'Only the assigned provider can confirm dispatch' });
        }

        if (job.status !== JobStatus.PROVIDER_ACCEPTED && job.status !== JobStatus.ACCEPTED) {
            return res.status(400).json({ success: false, message: 'Job is not in a state awaiting dispatch confirmation' });
        }

        // VALIDATION: Ensure pre-requisites are met
        const service = await mongoose.model('Service').findOne({
            code: job.serviceCode,
            countryCode: { $in: [job.countryCode, 'GLOBAL'] }
        }).sort({ countryCode: -1 });

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service configuration not found.' });
        }

        // Forensic Fix: Use explicit boolean checks to prevent bypassing negotiation for negotiation-only services
        if (service.photoSharingRequired === true && !job.taskPhotosSeen) {
            return res.status(403).json({ success: false, message: 'You must review the task photos before dispatching.' });
        }

        if (service.priceNegotiationRequired === true && job.priceStatus !== 'ACCEPTED') {
            return res.status(403).json({ success: false, message: 'You must agree on a price before dispatching.' });
        }

        job.status = JobStatus.EN_ROUTE;
        if (!job.agreedPrice) job.agreedPrice = (job.serviceFee || 0) + job.bookingFee; // Use estimate if no negotiation

        job.negotiationTimeline.push({
            event: 'DISPATCH_CONFIRMED',
            timestamp: new Date()
        });

        await job.save();

        // Unified Real-Time Sync
        syncJobStatus(job, 'status_updated');

        await notificationService.notifyUser(
            job.customerId.toString(),
            'Provider Dispatched',
            'Your provider has reviewed the details and is now on the way.'
        );

        res.status(200).json({ success: true, message: 'Dispatch confirmed', job: await sanitizeJobForMobile(job) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to confirm dispatch', error });
    }
};
