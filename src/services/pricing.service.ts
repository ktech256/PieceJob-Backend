import PricingRule, { IPricingRule, PricingLevel } from '../models/PricingRule';
import CommissionRule from '../models/CommissionRule';
import Job from '../models/Job';
import { JobStatus } from '../models/Job';
import * as settingsService from './settings.service';
import { ProviderTier } from '../models/Provider';
import mongoose from 'mongoose';

export interface PricingBreakdown {
    basePrice: number;
    hourlyPrice: number;
    bookingFee: number;
    platformFee: number;
    calloutFee: number;
    minimumCharge: number;
    surcharges: { type: string, amount: number }[];
    taxAmount: number;
    taxPercentage: number;
    totalAmount: number;
    currency: string;
    currencySymbol: string;
    surgeMultiplier: number;
}

export const calculateJobPrice = async (
    serviceCode: string,
    countryCode: string,
    zoneId?: string,
    isEmergency: boolean = false
): Promise<PricingBreakdown> => {
    const settings = await settingsService.getSettings(countryCode);

    // 1. Resolve Rules (Highest priority first)
    // Hierarchy: ZONE > SERVICE > COUNTRY
    const rules = await PricingRule.find({
        countryCode,
        isActive: true,
        $or: [
            { level: PricingLevel.ZONE, zoneId },
            { level: PricingLevel.SERVICE, serviceCode },
            { level: PricingLevel.COUNTRY }
        ]
    }).sort({ priority: -1, createdAt: -1 });

    // Merge rules (simple strategy: take first matched values for each component)
    let basePrice = 0;
    let hourlyPrice = 0;
    let surgeMultiplier = 1.0;
    let emergencyMultiplier = 1.0;
    let weekendMultiplier = 1.0;
    let nightMultiplier = 1.0;
    let holidayMultiplier = 1.0;

    // Apply rules in order of priority
    for (const rule of rules) {
        if (rule.basePrice > 0 && basePrice === 0) basePrice = rule.basePrice;
        if (rule.hourlyPrice > 0 && hourlyPrice === 0) hourlyPrice = rule.hourlyPrice;
        if (rule.surgeMultiplier > 1.0 && surgeMultiplier === 1.0) surgeMultiplier = rule.surgeMultiplier;
        if (rule.emergencyPriceMultiplier > 1.0 && emergencyMultiplier === 1.0) emergencyMultiplier = rule.emergencyPriceMultiplier;
        if (rule.weekendPriceMultiplier > 1.0 && weekendMultiplier === 1.0) weekendMultiplier = rule.weekendPriceMultiplier;
        if (rule.nightPriceMultiplier > 1.0 && nightMultiplier === 1.0) nightMultiplier = rule.nightPriceMultiplier;
        if (rule.holidayPriceMultiplier > 1.0 && holidayMultiplier === 1.0) holidayMultiplier = rule.holidayPriceMultiplier;
    }

    // 2. Apply Time-based surcharges
    const surcharges: { type: string, amount: number }[] = [];
    const now = new Date();

    // Weekend
    const isWeekend = [0, 6].includes(now.getDay());
    if (isWeekend && settings.weekendFeeEnabled) {
        const amt = basePrice * (weekendMultiplier - 1 + (settings.weekendFeePercentage / 100));
        if (amt > 0) surcharges.push({ type: 'WEEKEND', amount: amt });
    }

    // Night (Simple hour check)
    const hour = now.getHours();
    const startHour = parseInt(settings.nightFeeStart?.split(':')[0] || '22');
    const endHour = parseInt(settings.nightFeeEnd?.split(':')[0] || '05');
    const isNight = hour >= startHour || hour < endHour;
    if (isNight && settings.nightFeeEnabled) {
        const amt = basePrice * (nightMultiplier - 1 + (settings.nightFeePercentage / 100));
        if (amt > 0) surcharges.push({ type: 'NIGHT', amount: amt });
    }

    // Emergency
    if (isEmergency) {
        const amt = basePrice * (emergencyMultiplier - 1);
        if (amt > 0) surcharges.push({ type: 'EMERGENCY', amount: amt });
    }

    // 3. AI PriceBot Impact (Demand Surge)
    const activeJobsCount = await Job.countDocuments({
        serviceCode,
        countryCode,
        cityOrZoneId: zoneId,
        status: { $in: [JobStatus.BROADCASTED, JobStatus.ACCEPTED] }
    });

    if (activeJobsCount > 10) {
        surgeMultiplier = Math.min(surgeMultiplier + 0.2, settings.surgeMultiplierMax);
    }

    // 4. Sum up
    let subtotal = basePrice * surgeMultiplier;
    surcharges.forEach(s => subtotal += s.amount);

    const bookingFee = settings.bookingFee || settings.baseBookingFee || 0;
    const platformFee = settings.platformFee || 0;
    const calloutFee = settings.calloutFee || 0;

    let total = subtotal + bookingFee + platformFee + calloutFee;
    if (total < settings.minimumCharge) total = settings.minimumCharge;

    // 5. Tax
    let taxAmount = 0;
    if (settings.taxPercentage > 0) {
        if (settings.isTaxInclusive) {
            taxAmount = total - (total / (1 + settings.taxPercentage / 100));
        } else {
            taxAmount = total * (settings.taxPercentage / 100);
            total += taxAmount;
        }
    }

    return {
        basePrice,
        hourlyPrice,
        bookingFee,
        platformFee,
        calloutFee,
        minimumCharge: settings.minimumCharge,
        surcharges,
        taxAmount,
        taxPercentage: settings.taxPercentage,
        totalAmount: total,
        currency: settings.currencyCode || settings.currency,
        currencySymbol: settings.currencySymbol || settings.currencyCode || settings.currency,
        surgeMultiplier
    };
};

export const getCommissionRate = async (countryCode: string, tier: ProviderTier): Promise<number> => {
    const rule = await CommissionRule.findOne({ countryCode, tier, isActive: true });
    if (rule) return rule.commissionPercentage;

    // PAGE 7: DEFAULT TIER COMMISSIONS
    const defaults: Record<string, number> = {
        [ProviderTier.BRONZE]: 20,
        [ProviderTier.SILVER]: 18,
        [ProviderTier.GOLD]: 15,
        [ProviderTier.PLATINUM]: 12,
        [ProviderTier.ELITE]: 10
    };

    return defaults[tier] || 15;
};
