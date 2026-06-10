import Job, { JobStatus } from '../models/Job';
import Provider from '../models/Provider';
import { IJob } from '../models/Job';
import mongoose from 'mongoose';
import { emitToUser } from '../socket/socket.service';

export const findEligibleProviders = async (job: IJob, wave: number) => {
  const query: any = {
    isOnline: true,
    verificationStatus: 'APPROVED',
    suspendedUntil: { $lt: new Date() },
    servicesOffered: job.serviceCode,
    countryCode: job.countryCode
  };

  let maxDistance = 10000; // Default 10km (Wave 3)

  if (wave === 1) {
    maxDistance = 2000; // 2km
    query.tier = { $in: ['ELITE', 'PLATINUM'] };
  } else if (wave === 2) {
    maxDistance = 5000; // 5km
    query.tier = { $in: ['GOLD', 'SILVER', 'ELITE', 'PLATINUM'] };
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

    providers.forEach(p => {
      // Emit socket and push notification
      emitToUser(p.userId.toString(), 'NEW_JOB_BROADCAST', {
        jobId: currentJob.id,
        serviceCode: currentJob.serviceCode,
        location: currentJob.location
      });
    });

    if (wave < 3 && providers.length < 10) {
      // Waves at 0s, 10s, 25s. So wait 10s then 15s.
      const nextDelay = wave === 1 ? 10000 : 15000;
      setTimeout(() => runWave(wave + 1), nextDelay);
    }
  };

  runWave(1);
};

export const acceptJob = async (jobId: string, providerId: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const job = await Job.findOneAndUpdate(
      { _id: jobId, providerId: null, status: JobStatus.BROADCASTED },
      {
        providerId,
        status: JobStatus.ACCEPTED,
        acceptedAt: new Date(),
        $inc: { version: 1 }
      },
      { session, new: true }
    );

    if (!job) {
      throw new Error('Job already accepted or unavailable');
    }

    await session.commitTransaction();
    return job;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
