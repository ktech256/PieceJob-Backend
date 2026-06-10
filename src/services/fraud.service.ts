import Job, { JobStatus } from '../models/Job';
import Provider from '../models/Provider';
import User from '../models/User';

import * as settingsService from './settings.service';

export const fraudSenseAnalysis = async (userId: string, role: string, countryCode: string = 'GLOBAL') => {
  // SECTION 15.1: FraudSense - Cancellation Pattern Detection
  const settings = await settingsService.getSettings(countryCode);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentCancellations = await Job.countDocuments({
    cancelledBy: userId,
    status: JobStatus.CANCELLED,
    createdAt: { $gt: twentyFourHoursAgo }
  });

  if (role === 'PROVIDER' && recentCancellations >= 4) {
    // SECTION 6: Anti-Abuse - lockout based on settings
    const suspensionEnd = new Date(Date.now() + settings.escrowCoolingPeriodHours * 60 * 60 * 1000);
    await Provider.findOneAndUpdate({ userId }, { suspendedUntil: suspensionEnd });
    return { flagged: true, action: 'SUSPENDED', reason: `High cancellation rate. Locked for ${settings.escrowCoolingPeriodHours}h.` };
  }

  if (role === 'CUSTOMER' && recentCancellations >= 5) {
    // Flag for manual review
    return { flagged: true, action: 'FLAGGED_FOR_REVIEW', reason: 'Abnormal customer cancellation pattern' };
  }

  return { flagged: false };
};

export const checkFakeCompletion = async (jobId: string) => {
  const job = await Job.findById(jobId);
  if (!job || job.status !== JobStatus.COMPLETED) return false;

  const durationSeconds = (job.completedAt!.getTime() - job.startedAt!.getTime()) / 1000;

  // Logic: If job completed in under 5 minutes for a task that usually takes 30+, flag it.
  if (durationSeconds < 300) {
     return true; // Suspected fake completion
  }
  return false;
};

export const checkGpsSpoofing = (currentCoords: number[], previousCoords: number[], timeDiffSeconds: number) => {
  // Simple velocity check: If speed > 100km/h in a residential zone (placeholder)
  // Or if jump is > 2km in 1 second.
  const distance = calculateDistance(currentCoords, previousCoords);
  const speed = distance / timeDiffSeconds;

  if (speed > 50) { // 50m/s = 180km/h
    return true; // Suspected spoofing
  }
  return false;
};

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
