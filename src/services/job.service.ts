import Job, { JobStatus } from '../models/Job';
import User from '../models/User';
import Provider, { ProviderTier } from '../models/Provider';
import Service, { GenderRule, VerificationLevel } from '../models/Service';
import { IJob } from '../models/Job';
import mongoose from 'mongoose';
import { emitToUser, emitJobUpdate } from '../socket/socket.service';
import * as broadcastQueue from './job-broadcast.queue';
import * as notificationService from './notification.service';

import * as settingsService from './settings.service';
import * as pricingService from './pricing.service';
import { calculateDistance } from '../utils/location';

export const findEligibleProviders = async (job: IJob, wave: number) => {
  console.log(`[MATCHING_AUDIT] Wave ${wave} for Job ${job._id}. Service: ${job.serviceCode}, Country: ${job.countryCode}`);
  console.log(`[MATCHING_AUDIT] Job Location: ${JSON.stringify(job.location.coordinates)} (Type: ${typeof job.location.coordinates[0]})`);

  const settings = await settingsService.getSettings(job.countryCode);
  const service = await Service.findOne({ code: job.serviceCode, isActive: true });

  if (!service) {
      console.error(`[MATCHING_AUDIT] FAILED: Service ${job.serviceCode} is inactive or not found.`);
      return [];
  }

  // 1. WAVE DISTANCE LOGIC
  let maxDistance = settings.matchingRadiusKm * 2 * 1000;
  if (wave === 1) maxDistance = (settings.matchingRadiusKm / 2.5) * 1000;
  else if (wave === 2) maxDistance = settings.matchingRadiusKm * 1000;

  // 2. DIAGNOSTIC SWEEP
  const allPotential = await Provider.find({
      servicesOffered: job.serviceCode,
      countryCode: job.countryCode
  }).populate('userId', 'firstName email fcmToken');

  console.log(`[MATCHING_AUDIT] Diagnostic check: Found ${allPotential.length} providers with service code ${job.serviceCode} in country ${job.countryCode}`);

  allPotential.forEach(p => {
      const user = p.userId as any;
      const reasons: string[] = [];

      if (!p.isOnline) reasons.push('Offline');
      if (p.verificationStatus !== 'APPROVED') reasons.push(`Verif:${p.verificationStatus}`);
      if (p.isShadowBanned) reasons.push('ShadowBanned');
      if (p.suspendedUntil && p.suspendedUntil > new Date()) reasons.push('Suspended');

      // Tier Check
      if (wave === 1 && ![ProviderTier.ELITE, ProviderTier.PLATINUM].includes(p.tier)) reasons.push(`Tier:${p.tier}!=Elite/Plat`);
      if (wave === 2 && p.tier !== ProviderTier.GOLD) reasons.push(`Tier:${p.tier}!=Gold`);
      if (wave === 3 && p.tier !== ProviderTier.SILVER) reasons.push(`Tier:${p.tier}!=Silver`);

      // Gender Rule
      if (service.genderRule === GenderRule.MEN_ONLY && p.gender !== 'M') reasons.push('Gender:MOnly');
      if (service.genderRule === GenderRule.WOMEN_ONLY && p.gender !== 'F') reasons.push('Gender:WOnly');

      // Verification Level
      const levelWeights: any = { STANDARD: 1, PROFESSIONAL: 2, TRADE: 3, HIGH_VETTING: 4 };
      if (levelWeights[p.verificationLevel] < levelWeights[service.verificationLevel]) reasons.push(`Level:${p.verificationLevel}<${service.verificationLevel}`);

      // Distance Check
      const distance = calculateDistance(p.location.coordinates, job.location.coordinates);
      if (distance > maxDistance) reasons.push(`Dist:${Math.round(distance/1000)}km>${maxDistance/1000}km`);

      // FCM Token Check
      if (!user?.fcmToken) reasons.push('FCM Token: MISSING');

      if (reasons.length > 0) {
          console.log(`[MATCHING_AUDIT] REJECTED ${user?.firstName || 'Unknown'} (${p._id}): ${reasons.join(', ')}. Coords: ${JSON.stringify(p.location.coordinates)}`);
      } else {
          console.log(`[MATCHING_AUDIT] ELIGIBLE ${user?.firstName} (${p._id}) found. Dist: ${Math.round(distance)}m`);
      }
  });

  // 3. ACTUAL DATABASE QUERY
  const query: any = {
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

  if (wave === 1) query.tier = { $in: [ProviderTier.ELITE, ProviderTier.PLATINUM] };
  else if (wave === 2) query.tier = ProviderTier.GOLD;
  else if (wave === 3) query.tier = ProviderTier.SILVER;

  if (service.genderRule === GenderRule.MEN_ONLY) query.gender = 'M';
  else if (service.genderRule === GenderRule.WOMEN_ONLY) query.gender = 'F';

  const levelWeights: any = { STANDARD: 1, PROFESSIONAL: 2, TRADE: 3, HIGH_VETTING: 4 };
  const requiredWeight = levelWeights[service.verificationLevel] || 1;
  const eligibleLevels = Object.entries(levelWeights).filter(([_, w]: any) => w >= requiredWeight).map(([l]) => l);
  query.verificationLevel = { $in: eligibleLevels };

  console.log(`[MATCHING_AUDIT] Final Main Query:`, JSON.stringify(query));

  const providers = await Provider.find({
    ...query,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: job.location.coordinates },
        $maxDistance: maxDistance
      }
    }
  }).limit(10).populate('userId', 'fcmToken role firstName');

  console.log(`[MATCHING_AUDIT] Main query result: Found ${providers.length} providers.`);

  for (const p of providers) {
      // FORCE RE-FETCH of User to ensure no population issues
      const user = await User.findById(p.userId).select('fcmToken email firstName');

      console.log(`[DATABASE_AUDIT] Provider: ${p._id} | User: ${p.userId}`);

      if (!user) {
          console.error(`[DATABASE_AUDIT] CRITICAL: User record NOT FOUND for provider.`);
          continue;
      }

      const token = user.fcmToken;
      if (!token) {
          console.log(`[DATABASE_AUDIT] User Email: ${user.email} | FCM Token: MISSING (NULL/UNDEFINED)`);
      } else {
          console.log(`[DATABASE_AUDIT] User Email: ${user.email}`);
          console.log(`[DATABASE_AUDIT] TokenLen:   ${token.length}`);
          console.log(`[DATABASE_AUDIT] TokenStart: ${token.substring(0, 25)}`);
          console.log(`[DATABASE_AUDIT] TokenEnd:   ${token.substring(token.length - 10)}`);
      }
  }

  return providers;
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

    // Signal Customer App
    emitJobUpdate(jobId, 'broadcast_wave', {
        wave,
        providerCount: providers.length,
        status: 'SEARCHING'
    });

    providers.forEach(p => {
      // Robustly handle populated vs unpopulated userId
      const targetUserId = (p.userId as any)._id || p.userId;

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

    // PAGE 7: Track Accepted Jobs
    provider.performance.acceptedJobs += 1;
    provider.currentAvailabilityStatus = 'BUSY';
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
