import Pricing from '../models/Pricing';
import Job from '../models/Job';
import { JobStatus } from '../models/Job';
import * as settingsService from './settings.service';

export const resolveDynamicPricing = async (serviceCode: string, countryCode: string, zoneId?: string) => {
  // SECTION 17: Pricing Resolver
  const pricing = await Pricing.findOne({ serviceCode, countryCode, zoneId });
  const settings = await settingsService.getSettings(countryCode);

  if (!pricing) throw new Error('Pricing configuration not found');

  let finalBookingFee = pricing.bookingFee;
  let currentMultiplier = pricing.surgeMultiplier;

  // SECTION 26: AI Readiness - PriceBot - Demand Spike Detection
  const activeJobsCount = await Job.countDocuments({
    serviceCode,
    countryCode,
    cityOrZoneId: zoneId,
    status: { $in: [JobStatus.BROADCASTED, JobStatus.ACCEPTED] }
  });

  if (activeJobsCount > 10) {
    currentMultiplier = Math.min(pricing.surgeMultiplier + 0.5, settings.surgeMultiplierMax);
  }

  // Section 11: Time Surcharges (Weekend check)
  const isWeekend = [0, 6].includes(new Date().getDay());
  if (isWeekend) {
    finalBookingFee += pricing.weekendSurcharge;
  }

  return {
    bookingFee: finalBookingFee,
    surgeMultiplier: currentMultiplier,
    currency: pricing.currency
  };
};
