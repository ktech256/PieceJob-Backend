import Job, { JobStatus } from '../models/Job';
import Provider, { ProviderTier } from '../models/Provider';
import Service, { GenderRule, VerificationLevel } from '../models/Service';
import { IJob } from '../models/Job';
import mongoose from 'mongoose';
import { emitToUser } from '../socket/socket.service';

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
      query.gender = 'W';
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

  const runWave = async (wave: number) => {
    // Re-fetch job to check if already accepted
    const currentJob = await Job.findById(jobId);
    if (!currentJob || currentJob.status !== JobStatus.BROADCASTED) return;

    console.log(`Broadcasting Job ${jobId} - Wave ${wave} started`);
    const providers = await findEligibleProviders(currentJob, wave);

    // PAGE 7: Track Broadcast Opportunities
    await Provider.updateMany(
        { _id: { $in: providers.map(p => p._id) } },
        { $inc: { 'performance.broadcastOpportunities': 1 } }
    );

    providers.forEach(p => {
      // Emit socket and push notification
      emitToUser(p.userId.toString(), 'NEW_JOB_BROADCAST', {
        jobId: currentJob.id,
        serviceCode: currentJob.serviceCode,
        location: currentJob.location
      });
    });

    if (wave < 4 && providers.length < 10) {
      // Waves: Wave 1 (0s), Wave 2 (5s), Wave 3 (10s), Wave 4 (25s)
      const delays = [0, 5000, 5000, 15000];
      const nextDelay = delays[wave] || 15000;
      setTimeout(() => runWave(wave + 1), nextDelay);
    }
  };

  runWave(1);
};

export const acceptJob = async (jobId: string, providerId: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const provider = await Provider.findOne({ userId: providerId }).session(session);
    if (!provider) throw new Error('Provider profile not found');

    const job = await Job.findOne({ _id: jobId, providerId: null, status: JobStatus.BROADCASTED }).session(session);
    if (!job) throw new Error('Job already accepted or unavailable');

    // PAGE 4.6 – COMMISSION LOCK SNAPSHOT
    const commissionRate = await pricingService.getCommissionRate(job.countryCode, provider.tier);

    job.providerId = providerId as any;
    job.status = JobStatus.ACCEPTED;
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
