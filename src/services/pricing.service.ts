import Pricing from '../models/Pricing';
import Job from '../models/Job';
import { JobStatus } from '../models/Job';

export const resolveDynamicPricing = async (serviceCode: string, countryCode: string, zoneId?: string) => {
  // SECTION 17: Pricing Resolver
  const pricing = await Pricing.findOne({ serviceCode, countryCode, zoneId });
  if (!pricing) throw new Error('Pricing configuration not found');

  let finalBookingFee = pricing.bookingFee;
  let currentMultiplier = pricing.surgeMultiplier;

  // SECTION 26: AI Readiness - PriceBot - Demand Spike Detection
  // Check active jobs in this zone vs online providers
  const activeJobsCount = await Job.countDocuments({
    serviceCode,
    countryCode,
    cityOrZoneId: zoneId,
    status: { $in: [JobStatus.BROADCASTED, JobStatus.ACCEPTED] }
  });

  // If demand is high (e.g. > 10 active requests), apply dynamic surge
  if (activeJobsCount > 10) {
    currentMultiplier = Math.min(pricing.surgeMultiplier + 0.5, 2.5); // Max surge cap 2.5 as per specification
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
