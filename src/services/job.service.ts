import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import Provider, { ProviderTier } from '../models/Provider';
import Service, { GenderRule, VerificationLevel } from '../models/Service';
import { IJob } from '../models/Job';
import mongoose from 'mongoose';
import { emitToUser, emitJobUpdate, emitAdminUpdate, emitToWorkspace, isUserConnected } from '../socket/socket.service';
import { addJobToBroadcastQueue } from './job-broadcast.queue';
import * as notificationService from './notification.service';
import * as performanceService from './provider-performance.service';
import * as fraudService from './fraud.service';
import * as userContextService from './user-context.service';
import * as financialService from './financial.service';
import { logger } from '../utils/logger';

import * as settingsService from './settings.service';
import * as pricingService from './pricing.service';
import { calculateDistance } from '../utils/location';

/**
 * Forensic helper to recover missing countryCode and currency from any associated participant.
 */
const recoverJobMetadata = async (job: IJob, session: mongoose.ClientSession) => {
    const User = mongoose.model('User');
    const Provider = mongoose.model('Provider');

    let recoveredCountry = job.countryCode;
    let recoveredCurrency = job.pricingSnapshot?.currencyCode;

    // 1. Try Provider Profile
    if (!recoveredCountry && job.providerId) {
        const provider = await Provider.findOne({ userId: job.providerId }).session(session);
        if (provider?.countryCode) recoveredCountry = provider.countryCode;

        if (!recoveredCountry) {
            const providerUser = await User.findById(job.providerId).session(session);
            if (providerUser?.countryCode) recoveredCountry = providerUser.countryCode;
        }
    }

    // 2. Try Customer User Profile
    if (!recoveredCountry && job.customerId) {
        const customerUser = await User.findById(job.customerId).session(session);
        if (customerUser?.countryCode) recoveredCountry = customerUser.countryCode;
    }

    // 3. Fallback to System Settings / First Active Country if still missing
    if (!recoveredCountry) {
        const Country = mongoose.model('Country');
        const activeCountry = await Country.findOne({ isActive: true }).session(session);
        if (activeCountry) {
            recoveredCountry = activeCountry.code;
            recoveredCurrency = recoveredCurrency || activeCountry.currency;
        }
    }

    // Apply repairs to the document
    if (recoveredCountry && !job.countryCode) {
        logger.info(`JOB_COMPLETION | Repairing missing countryCode for Job: ${job._id} -> ${recoveredCountry}`);
        job.countryCode = recoveredCountry;
    }

    if (recoveredCurrency && !job.pricingSnapshot?.currencyCode) {
        if (!job.pricingSnapshot) {
            job.pricingSnapshot = {
                basePrice: 0,
                hourlyPrice: 0,
                bookingFee: job.bookingFee,
                taxPercentage: 0,
                currencyCode: recoveredCurrency || 'USD',
                surcharges: []
            };
        } else {
            job.pricingSnapshot.currencyCode = recoveredCurrency || 'USD';
        }
    }

    return { countryCode: recoveredCountry, currency: recoveredCurrency || 'USD' };
};

export const completeJob = async (jobId: string, adminOverride: boolean = false) => {
    const MAX_RETRIES = 5; // Increased retries for high concurrency
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const job = await Job.findById(jobId).session(session);
            if (!job) throw new Error('Job not found');

            if (job.status === JobStatus.COMPLETED || job.status === JobStatus.CLOSED || job.status === JobStatus.RATED) {
                await session.commitTransaction();
                session.endSession();
                return job; // Already completed
            }

            // FORENSIC: Verify and repair countryCode and currency early
            const metadata = await recoverJobMetadata(job, session);

            if (!job.countryCode) {
                throw new Error(`JOB_COMPLETION_FAILED: countryCode missing and unrecoverable for Job: ${jobId}`);
            }

            // PAGE 4.6 – COMPLETED JOB FINANCIALS (Using Snapshots)
            // Run financials BEFORE status change to ensure retryability
            const totalAmount = (job.serviceFee || 0) + job.bookingFee;
            const serviceFeeRate = job.serviceFeeRateSnapshot || 15;

            if (!job.providerId) {
                throw new Error(`JOB_COMPLETION_FAILED: Cannot complete a job that has no assigned provider.`);
            }

            await financialService.completeJobFinancials(
                job,
                job.providerId.toString(),
                totalAmount,
                serviceFeeRate,
                metadata.currency,
                job.countryCode,
                session
            );

            job.status = JobStatus.COMPLETED;
            job.completedAt = new Date();
            await job.save({ session });

            // PAGE 7: Increment Completed Jobs
            const provider = await Provider.findOne({ userId: job.providerId }).session(session);
            if (provider) {
                provider.jobsCompleted += 1;
                provider.performance.completedJobs += 1;
                provider.currentAvailabilityStatus = provider.isOnline ? 'ONLINE' : 'OFFLINE';
                await provider.save({ session });
            }

            // PAGE 12: Fraud Analysis (Fake Completion)
            // Note: This service call should ideally be transactional if it modifies DB,
            // but if it's async/queue based, it's fine.
            fraudService.analyzeJobCompletion(job.id);

            // Track frequent address (Issue 2)
            await userContextService.trackJobAddress(job.customerId.toString(), job.location.address || '', job.location.coordinates);

            await session.commitTransaction();
            session.endSession();

            // EMIT SOCKET EVENTS ONLY AFTER SUCCESSFUL COMMIT
            const socketService = require('../socket/socket.service');
            socketService.syncJobStatus(job, 'status_updated', { adminOverride });

            if (provider) {
                socketService.emitAdminUpdate('provider_status_changed', {
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
                adminOverride
                    ? 'Administrator has marked your job as completed. Please rate your provider.'
                    : 'Your job has been marked as completed. Please rate your provider.'
            );

            return job;
        } catch (error: any) {
            await session.abortTransaction();
            session.endSession();

            const isWriteConflict = error.message.includes('Write conflict') || error.code === 112 || error.hasErrorLabel?.('TransientTransactionError');
            if (isWriteConflict && retryCount < MAX_RETRIES - 1) {
                retryCount++;
                const delay = Math.pow(2, retryCount) * 100 + Math.random() * 100; // Exponential backoff with jitter
                logger.warn(`JOB_COMPLETION | Write conflict. Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                logger.error(`JOB_COMPLETION | FATAL ERROR | Job: ${jobId} | Error: ${error.message}`);
                throw error;
            }
        }
    }
};

export const findEligibleProviders = async (job: IJob, wave: number) => {
  const settings = await settingsService.getSettings(job.countryCode);
  const service = await Service.findOne({
      code: job.serviceCode,
      countryCode: { $in: [job.countryCode, 'GLOBAL'] },
      isActive: true
  }).sort({ countryCode: -1 });

  if (!service) {
      logger.error(`MATCHING | FAILED: Service ${job.serviceCode} inactive/not found.`);
      return [];
  }

  // 1. WAVE DISTANCE LOGIC
  let maxDistance = settings.matchingRadiusKm * 2 * 1000;
  if (wave === 1) maxDistance = (settings.matchingRadiusKm / 2.5) * 1000;
  else if (wave === 2) maxDistance = settings.matchingRadiusKm * 1000;

  // 2. BASE QUERY
  const baseQuery: any = {
    isOnline: true,
    currentAvailabilityStatus: 'ONLINE', // Ensure provider is not busy with another job
    verificationStatus: 'APPROVED',
    isShadowBanned: { $ne: true },
    $or: [
        { suspendedUntil: { $exists: false } },
        { suspendedUntil: { $lt: new Date() } }
    ],
    servicesOffered: job.serviceCode,
    countryCode: job.countryCode,
    userId: { $nin: job.notifiedProviderIds || [] }
  };

  if (service.genderRule === GenderRule.MEN_ONLY) baseQuery.gender = 'M';
  else if (service.genderRule === GenderRule.WOMEN_ONLY) baseQuery.gender = 'F';

  const levelWeights: any = { STANDARD: 1, PROFESSIONAL: 2, TRADE: 3, HIGH_VETTING: 4 };
  const requiredWeight = levelWeights[service.verificationLevel] || 1;
  const eligibleLevels = Object.entries(levelWeights).filter(([_, w]: any) => w >= requiredWeight).map(([l]) => l);
  baseQuery.verificationLevel = { $in: eligibleLevels };

  // 3. TIER FALLBACK LOGIC
  const tierPriorities = [
      [ProviderTier.ELITE, ProviderTier.PLATINUM],
      [ProviderTier.GOLD],
      [ProviderTier.SILVER],
      [ProviderTier.BRONZE]
  ];

  // Determine starting point based on wave
  let startIdx = 0;
  if (wave === 2) startIdx = 1;
  else if (wave === 3) startIdx = 2;
  else if (wave >= 4) startIdx = 3;

  let foundProviders: any[] = [];
  let selectedTierLabel = 'None';

  const stats: Record<string, number> = { [ProviderTier.ELITE]: 0, [ProviderTier.PLATINUM]: 0, [ProviderTier.GOLD]: 0, [ProviderTier.SILVER]: 0, [ProviderTier.BRONZE]: 0 };

  for (let i = startIdx; i < tierPriorities.length; i++) {
      const tiers = tierPriorities[i];
      const providers = await Provider.find({
          ...baseQuery,
          tier: { $in: tiers },
          location: {
              $near: {
                  $geometry: { type: 'Point', coordinates: job.location.coordinates },
                  $maxDistance: maxDistance
              }
          }
      }).limit(10).populate('userId', 'fcmToken role firstName email');

      if (providers.length > 0) {
          // FORENSIC REPAIR: Filter out providers who have NO fcmToken AND are NOT connected via Socket
          // This prevents "Zombie Online" providers from hogging waves.
          const reachableProviders = providers.filter(p => {
              const user = p.userId as any;
              const hasToken = user && user.fcmToken;
              const hasSocket = isUserConnected(user?._id.toString());

              if (!hasToken && !hasSocket) {
                  console.log(`[MATCHING_AUDIT] Skipping Zombie Provider: ${p._id} (No Token & No Socket)`);
                  return false;
              }
              return true;
          });

          if (reachableProviders.length > 0) {
              foundProviders = reachableProviders;
              selectedTierLabel = tiers.join('/');

              // Update stats for the summary
              reachableProviders.forEach(p => {
                  const t = p.tier as string;
                  if (stats[t] !== undefined) stats[t]++;

                  // FORENSIC AUDIT DURING MATCHING
                  const user = p.userId as any;
                  console.log(`[DATABASE_AUDIT] Matched Provider: ${p._id}`);
                  console.log(`[DATABASE_AUDIT] User ID: ${user?._id}`);
                  if (user) {
                      const token = user.fcmToken || 'NULL';
                      console.log(`[DATABASE_AUDIT] Stored FCM Token: ${token !== 'NULL' ? token.substring(0, 15) + '...' : 'NULL'}`);
                      console.log(`[DATABASE_AUDIT] Socket Connected: ${isUserConnected(user._id.toString())}`);
                  } else {
                      console.log(`[DATABASE_AUDIT] User object MISSING in population.`);
                  }
              });
              break;
          }
      }
  }

  const summary = `Service: ${job.serviceCode} | Search: Elite:${stats[ProviderTier.ELITE]}, Plat:${stats[ProviderTier.PLATINUM]}, Gold:${stats[ProviderTier.GOLD]}, Silver:${stats[ProviderTier.SILVER]}, Bronze:${stats[ProviderTier.BRONZE]} | Selected: ${selectedTierLabel} | Found: ${foundProviders.length}`;
  logger.matching(job._id.toString(), wave, summary);

  return foundProviders;
};

export const broadcastJob = async (jobId: string) => {
  const job = await Job.findById(jobId);
  if (!job || job.status !== JobStatus.BROADCASTED) return;

  await addJobToBroadcastQueue(jobId, 1);
};

export const resumeBroadcasts = async () => {
    const jobs = await Job.find({ status: JobStatus.BROADCASTED });
    logger.info(`MATCHING | RESUMING_BROADCASTS | Count: ${jobs.length}`);
    for (const job of jobs) {
        await addJobToBroadcastQueue(job._id.toString(), 1);
    }
};

export const executeBroadcastWave = async (jobId: string, wave: number): Promise<number | null> => {
    const job = await Job.findById(jobId);
    if (!job || job.status !== JobStatus.BROADCASTED) return null;

    logger.debug(`Executing Broadcast Wave ${wave} for Job ${jobId}`);
    const providers = await findEligibleProviders(job, wave);
    const providerUserIds = providers.map(p => (p.userId as any)._id || p.userId);

    // Track notified providers to avoid duplicates in next waves
    if (providerUserIds.length > 0) {
        await Job.findByIdAndUpdate(jobId, {
            $addToSet: { notifiedProviderIds: { $each: providerUserIds } }
        });
    }

    // Track Broadcast Opportunities
    await Provider.updateMany(
        { _id: { $in: providers.map(p => p._id) } },
        { $inc: { 'performance.broadcastOpportunities': 1 } }
    );

    // Signal Customer App
    emitJobUpdate(jobId, 'broadcast_wave', {
        wave,
        providerCount: providers.length,
        status: 'SEARCHING'
    });

    providers.forEach(p => {
      const targetUserId = (p.userId as any)._id || p.userId;
      const user = p.userId as any;

      const distanceMeters = calculateDistance(p.location.coordinates, job.location.coordinates);
      let distanceLabel = 'Nearby';
      if (distanceMeters !== Infinity && !isNaN(distanceMeters)) {
          const distanceKm = (distanceMeters / 1000).toFixed(1);
          distanceLabel = distanceMeters < 1000 ? `${Math.round(distanceMeters)}m away` : `${distanceKm}km away`;
      }

      // HIDE SPECIFIC ADDRESS: \"139 Erasmus St, Flora Park, Polokwane, 0699,\" -> \"Flora Park, Polokwane\"
      const rawAddress = job.location.address || '';
      const addressParts = rawAddress.split(',').map(p => p.trim()).filter(p => p.length > 0);

      let obscuredAddress = 'Nearby Location';
      if (addressParts.length >= 3) {
          obscuredAddress = `${addressParts[1]}, ${addressParts[2]}`;
      } else if (addressParts.length >= 1) {
          obscuredAddress = addressParts[0];
      }

      const obscuredLocation = {
          type: 'Point',
          coordinates: job.location.coordinates,
          address: obscuredAddress
      };

      console.log(`[BROADCAST_AUDIT] Starting broadcast for Job: ${job.id} to User: ${targetUserId}`);

      // 1. Socket.IO Delivery (Primary for Live)
      const isConnected = isUserConnected(targetUserId.toString());
      console.log(`[BROADCAST_AUDIT] User ${targetUserId} Socket Connected: ${isConnected}`);

      emitToUser(targetUserId.toString(), 'NEW_JOB_BROADCAST', {
        jobId: job.id,
        serviceCode: job.serviceCode,
        serviceName: job.serviceName,
        location: obscuredLocation,
        address: obscuredAddress,
        distance: distanceLabel,
        isForSomeoneElse: job.isForSomeoneElse,
        recipientName: job.recipientName
      });

      // 2. FCM Notification (Backup / Background)
      notificationService.notifyUser(
          targetUserId,
          'New Job Available',
          `A new ${job.serviceName || job.serviceCode} request is ${distanceLabel}.`,
          {
              type: 'NEW_JOB_BROADCAST',
              jobId: job.id,
              serviceCode: job.serviceCode,
              serviceName: job.serviceName,
              address: obscuredAddress,
              recipientName: job.recipientName,
              distance: distanceLabel
          },
          true // Send as Data-Only message for custom handling
      ).then(res => {
          console.log(`[BROADCAST_AUDIT] FCM Result for User ${targetUserId}: ${res?.success ? 'SUCCESS' : 'FAILED (' + res?.error + ')'}`);
      });
    });

    if (wave < 4) {
        return wave + 1;
    }

    return null;
};

export const acceptJob = async (jobId: string, providerId: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const provider = await Provider.findOne({ userId: providerId }).session(session);
    if (!provider) throw new Error('Provider profile not found');

    const job = await Job.findOne({ _id: jobId, providerId: null, status: JobStatus.BROADCASTED }).session(session);
    if (!job) throw new Error('Job already accepted or unavailable');

    const service = await Service.findOne({
        code: job.serviceCode,
        countryCode: { $in: [job.countryCode, 'GLOBAL'] }
    }).sort({ countryCode: -1 });
    if (service) {
        if (service.genderRule === GenderRule.MEN_ONLY && provider.gender !== 'M') {
            throw new Error('Gender rule violation: Service restricted to Men.');
        }
        if (service.genderRule === GenderRule.WOMEN_ONLY && provider.gender !== 'F') {
            throw new Error('Gender rule violation: Service restricted to Women.');
        }
    }

    const serviceFeeRate = await pricingService.getServiceFeeRate(job.countryCode, provider.tier);

    job.providerId = providerId as any;

    // PHASE 3: Dispatch Control
    // Forensic: Handle undefined flags by checking truthiness explicitly
    const negotiationRequired = service?.priceNegotiationRequired === true;
    const photoSharingRequired = service?.photoSharingRequired === true;

    job.photoSharingRequired = photoSharingRequired;
    job.priceNegotiationRequired = negotiationRequired;

    if (negotiationRequired || photoSharingRequired) {
        job.status = JobStatus.PROVIDER_ACCEPTED; // Hold dispatch for negotiation or photos
    } else {
        job.status = JobStatus.EN_ROUTE; // Dispatch immediately (Type 3)
    }

    job.negotiationTimeline = [{
        event: 'PROVIDER_ACCEPTED',
        timestamp: new Date(),
        metadata: { providerId }
    }];

    job.acceptedAt = new Date();
    job.serviceFeeRateSnapshot = serviceFeeRate;
    job.version += 1;

    await job.save({ session });

    // Stop every remaining broadcast wave for this job
    try {
        const { clearJobBroadcasts } = require('./job-broadcast.queue');
        await clearJobBroadcasts(jobId);
    } catch (e) {
        logger.error(`Error clearing broadcasts for job ${jobId}: ${e}`);
    }

    logger.info(`JOB | ACCEPTED | Job: ${jobId} | Provider: ${providerId}`);

    // Termination Signal: Tell other providers to stop ringing
    const otherProviders = await Provider.find({
        servicesOffered: job.serviceCode,
        countryCode: job.countryCode,
        isOnline: true,
        userId: { $ne: new mongoose.Types.ObjectId(providerId) }
    }).session(session);

    otherProviders.forEach(p => {
        const targetUserId = (p.userId as any)._id || p.userId;
        emitToUser(targetUserId.toString(), 'JOB_ASSIGNED_ELSEWHERE', { jobId });
        notificationService.notifyUser(
            targetUserId,
            'Job No Longer Available',
            'This request was accepted by another provider.',
            { type: 'JOB_ASSIGNED_ELSEWHERE', jobId },
            true
        );
    });

    provider.performance.acceptedJobs += 1;
    provider.currentAvailabilityStatus = 'BUSY';
    await provider.save({ session });

    console.log(`[FORENSIC] DB_UPDATE_FINISHED | Job: ${jobId} | New Status: ${job.status}`);

    await session.commitTransaction();
    return job;
  } catch (error: any) {
    await session.abortTransaction();
    logger.error(`JOB | ACCEPT_FAILED | Job: ${jobId} | Error: ${error.message}`);
    throw error;
  } finally {
    session.endSession();
  }
};

export const expireInactiveNegotiations = async () => {
    const settings = await settingsService.getSettings('GLOBAL');
    const expiryHours = settings?.maxNegotiationRounds || 24; // Use maxNegotiationRounds field if available, or 24h
    const expiryDate = new Date(Date.now() - expiryHours * 60 * 60 * 1000);

    const jobsToExpire = await Job.find({
        status: JobStatus.PROVIDER_ACCEPTED,
        priceStatus: 'PENDING',
        updatedAt: { $lt: expiryDate }
    });

    for (const job of jobsToExpire) {
        job.priceStatus = 'EXPIRED';
        // We don't automatically cancel the job, but we mark the negotiation as expired.
        // The spec says \"Status EXPIRED. Notify both users.\"
        await job.save();

        await notificationService.notifyUser(job.customerId.toString(), 'Negotiation Expired', 'The price negotiation for your job has expired.');
        if (job.providerId) {
            await notificationService.notifyUser(job.providerId.toString(), 'Negotiation Expired', 'The price negotiation for your job has expired.');
        }

        emitJobUpdate(job.id, 'status_updated', { jobId: job.id, priceStatus: 'EXPIRED' });
    }
};