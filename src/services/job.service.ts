import Job, { JobStatus } from '../models/Job';
import Provider, { ProviderTier } from '../models/Provider';
import Service, { GenderRule, VerificationLevel } from '../models/Service';
import { IJob } from '../models/Job';
import mongoose from 'mongoose';
import { emitToUser } from '../socket/socket.service';
import * as broadcastQueue from './job-broadcast.queue';
import * as notificationService from './notification.service';

import * as settingsService from './settings.service';
import * as pricingService from './pricing.service';

export const findEligibleProviders = async (job: IJob, wave: number) => {
  const settings = await settingsService.getSettings(job.countryCode);

  // PAGE 5: Enforce Service Catalog Rules
  const service = await Service.findOne({ code: job.serviceCode, isActive: true });
  if (!service) {
      console.error(`Matching failed: Service ${job.serviceCode} is inactive or not found.`);
      return [];
  }

  const query: any = {
    isOnline: true,
    verificationStatus: 'APPROVED',
    isShadowBanned: { $ne: true }, // Exclude shadow banned
    suspendedUntil: { $lt: new Date() },
    servicesOffered: job.serviceCode,
    countryCode: job.countryCode
  };

  // PAGE 7: TIER-BASED WAVES
  if (wave === 1) {
    query.tier = { $in: [ProviderTier.ELITE, ProviderTier.PLATINUM] };
  } else if (wave === 2) {
    query.tier = { $in: [ProviderTier.GOLD] };
  } else if (wave === 3) {
    query.tier = { $in: [ProviderTier.SILVER] };
  }
  // Wave 4 includes all (Bronze and up)

  // Gender Rule Enforcement
  if (service.genderRule === GenderRule.MEN_ONLY) {
      query.gender = 'M';
  } else if (service.genderRule === GenderRule.WOMEN_ONLY) {
      query.gender = 'F';
  }

  // Verification Level Enforcement
  // Logic: Provider must have at least the required verification level
  const levelWeights = {
      [VerificationLevel.STANDARD]: 1,
      [VerificationLevel.PROFESSIONAL]: 2,
      [VerificationLevel.TRADE]: 3,
      [VerificationLevel.HIGH_VETTING]: 4
  };

  const requiredWeight = levelWeights[service.verificationLevel] || 1;
  const eligibleLevels = Object.entries(levelWeights)
      .filter(([_, weight]) => weight >= requiredWeight)
      .map(([level, _]) => level);

  query.verificationLevel = { $in: eligibleLevels };

  let maxDistance = settings.matchingRadiusKm * 2 * 1000;

  if (wave === 1) {
    maxDistance = (settings.matchingRadiusKm / 2.5) * 1000; // Priority providers see it closer first
  } else if (wave === 2) {
    maxDistance = settings.matchingRadiusKm * 1000;
  }

  return await Provider.find({
    ...query,
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: job.location.coordinates
        },
        $maxDistance: maxDistance
      }
    }
  }).limit(10);
};

export const broadcastJob = async (jobId: string) => {
  const job = await Job.findById(jobId);
  if (!job || job.status !== JobStatus.BROADCASTED) return;

  await broadcastQueue.addJobToBroadcastQueue(jobId, 1);
};

export const resumeBroadcasts = async () => {
    const jobs = await Job.find({ status: JobStatus.BROADCASTED });
    console.log(`Resuming broadcasts for ${jobs.length} jobs...`);
    for (const job of jobs) {
        await broadcastQueue.addJobToBroadcastQueue(job._id.toString(), 1);
    }
};

export const executeBroadcastWave = async (jobId: string, wave: number): Promise<number | null> => {
    const job = await Job.findById(jobId);
    if (!job || job.status !== JobStatus.BROADCASTED) return null;

    console.log(`Executing Broadcast Wave ${wave} for Job ${jobId}`);
    const providers = await findEligibleProviders(job, wave);

    // Track Broadcast Opportunities
    await Provider.updateMany(
        { _id: { $in: providers.map(p => p._id) } },
        { $inc: { 'performance.broadcastOpportunities': 1 } }
    );

    providers.forEach(p => {
      emitToUser(p.userId.toString(), 'NEW_JOB_BROADCAST', {
        jobId: job.id,
        serviceCode: job.serviceCode,
        location: job.location,
        isForSomeoneElse: job.isForSomeoneElse,
        recipientName: job.recipientName
      });

      // FCM Notification
      notificationService.notifyUser(
          p.userId.toString(),
          'New Job Available',
          `A new ${job.serviceCode} request is nearby.${job.isForSomeoneElse ? ' (For: ' + job.recipientName + ')' : ''}`
      );
    });

    // Determine if we need another wave
    // Spec: 4 waves total
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

    // SECTION: AUTHORITATIVE GENDER RULE ENFORCEMENT (RC-2 CRITICAL)
    const service = await Service.findOne({ code: job.serviceCode });
    if (service) {
        if (service.genderRule === GenderRule.MEN_ONLY && provider.gender !== 'M') {
            throw new Error('Gender rule violation: Service restricted to Men.');
        }
        if (service.genderRule === GenderRule.WOMEN_ONLY && provider.gender !== 'F') {
            throw new Error('Gender rule violation: Service restricted to Women.');
        }
    }

    // PAGE 4.6 – COMMISSION LOCK SNAPSHOT
    const commissionRate = await pricingService.getCommissionRate(job.countryCode, provider.tier);

    job.providerId = providerId as any;
    job.status = JobStatus.PROVIDER_ACCEPTED; // Use specific status from spec
    job.acceptedAt = new Date();
    job.commissionRateSnapshot = commissionRate;
    job.version += 1;

    await job.save({ session });

    // PAGE 7: Track Accepted Jobs
    provider.performance.acceptedJobs += 1;
    await provider.save({ session });

    await session.commitTransaction();
    return job;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
