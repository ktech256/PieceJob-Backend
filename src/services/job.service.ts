import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import Provider, { ProviderTier } from '../models/Provider';
import Service, { GenderRule, VerificationLevel } from '../models/Service';
import { IJob } from '../models/Job';
import mongoose from 'mongoose';
import { emitToUser, emitJobUpdate } from '../socket/socket.service';
import { addJobToBroadcastQueue } from './job-broadcast.queue';
import * as notificationService from './notification.service';
import { logger } from '../utils/logger';

import * as settingsService from './settings.service';
import * as pricingService from './pricing.service';
import { calculateDistance } from '../utils/location';

export const findEligibleProviders = async (job: IJob, wave: number) => {
  const settings = await settingsService.getSettings(job.countryCode);
  const service = await Service.findOne({ code: job.serviceCode, isActive: true });

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
    verificationStatus: 'APPROVED',
    isShadowBanned: { $ne: true },
    $or: [
        { suspendedUntil: { $exists: false } },
        { suspendedUntil: { $lt: new Date() } }
    ],
    servicesOffered: job.serviceCode,
    countryCode: job.countryCode
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
          foundProviders = providers;
          selectedTierLabel = tiers.join('/');

          // Update stats for the summary
          providers.forEach(p => {
              const t = p.tier as string;
              if (stats[t] !== undefined) stats[t]++;

              // FORENSIC AUDIT DURING MATCHING
              const user = p.userId as any;
              console.log(`[DATABASE_AUDIT] Matched Provider: ${p._id}`);
              console.log(`[DATABASE_AUDIT] User ID: ${user?._id}`);
              if (user) {
                  const token = user.fcmToken || 'NULL';
                  console.log(`[DATABASE_AUDIT] Stored FCM Token: ${token !== 'NULL' ? token.substring(0, 15) + '...' : 'NULL'}`);
              } else {
                  console.log(`[DATABASE_AUDIT] User object MISSING in population.`);
              }
          });
          break;
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

      emitToUser(targetUserId.toString(), 'NEW_JOB_BROADCAST', {
        jobId: job.id,
        serviceCode: job.serviceCode,
        location: job.location,
        isForSomeoneElse: job.isForSomeoneElse,
        recipientName: job.recipientName
      });

      // FCM Notification
      notificationService.notifyUser(
          targetUserId,
          'New Job Available',
          `A new ${job.serviceCode} request is nearby.${job.isForSomeoneElse ? ' (For: ' + job.recipientName + ')' : ''}`,
          {
              type: 'NEW_JOB_BROADCAST',
              jobId: job.id,
              serviceCode: job.serviceCode,
              address: job.location.address,
              recipientName: job.recipientName,
              distance: 'Nearby',
              earnings: `R ${job.bookingFee}`
          },
          true // Send as Data-Only message for custom handling
      );
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

    const service = await Service.findOne({ code: job.serviceCode });
    if (service) {
        if (service.genderRule === GenderRule.MEN_ONLY && provider.gender !== 'M') {
            throw new Error('Gender rule violation: Service restricted to Men.');
        }
        if (service.genderRule === GenderRule.WOMEN_ONLY && provider.gender !== 'F') {
            throw new Error('Gender rule violation: Service restricted to Women.');
        }
    }

    const commissionRate = await pricingService.getCommissionRate(job.countryCode, provider.tier);

    job.providerId = providerId as any;
    job.status = JobStatus.ACCEPTED;
    job.acceptedAt = new Date();
    job.commissionRateSnapshot = commissionRate;
    job.version += 1;

    await job.save({ session });

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
