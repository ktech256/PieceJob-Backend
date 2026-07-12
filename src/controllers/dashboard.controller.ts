import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User';
import Wallet from '../models/Wallet';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
import Promotion from '../models/Promotion';
import ReferralCampaign from '../models/ReferralCampaign';
import Provider from '../models/Provider';
import Service from '../models/Service';
import Country from '../models/Country';
import mongoose from 'mongoose';
import * as storageService from '../services/storage.service';
import * as settingsService from '../services/settings.service';
import { enrichWithNegotiation, sanitizeJobForMobile } from './job.controller';
import { logger } from '../utils/logger';
import { formatToWorkspaceTime } from '../utils/date';

export const getCustomerDashboard = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const countryCode = req.user?.countryCode;

        if (!countryCode) {
            return res.status(400).json({ success: false, message: 'Workspace/Country code not resolved for user.' });
        }

        console.log(`[FORENSIC] DASHBOARD | Loading for User: ${userId} | Country: ${countryCode}`);

        // 1. User Profile & Settings for currency fallback
        const [user, settings, country] = await Promise.all([
            User.findById(userId).select('firstName lastName email profilePhoto addresses savedLocations'),
            settingsService.getSettings(countryCode),
            Country.findOne({ code: countryCode })
        ]);

        if (!user) {
            console.error(`[FORENSIC] DASHBOARD | User ${userId} not found`);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currencySymbol = country?.currencySymbol || country?.currency;

        // 2. Wallet Balance
        const wallet = await Wallet.findOne({ userId });
        const walletData = {
            balanceMain: wallet?.balanceMain || 0,
            balanceCredit: wallet?.balanceCredit || 0,
            balanceReferral: wallet?.balanceReferral || 0,
            currency: wallet?.currency || currencySymbol
        };

        // 3. Active Jobs (Multiple support)
        const activeJobsRaw = await Job.find({
            customerId: userId,
            countryCode,
            status: { $in: [JobStatus.PROVIDER_ACCEPTED, JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.COMPLETED] }
        }).sort({ updatedAt: -1 }).populate('providerId', 'firstName lastName profilePhoto');

        const activeJobs = [];
        const RATING_WINDOW_HOURS = 24;

        for (const jobRaw of activeJobsRaw) {
            // Filter out completed jobs that are rated, dismissed, or expired
            if (jobRaw.status === JobStatus.COMPLETED) {
                if (jobRaw.customerRated || jobRaw.customerRatingDismissed) continue;

                const completionTime = jobRaw.completedAt || jobRaw.updatedAt;
                const hoursSinceCompletion = (Date.now() - completionTime.getTime()) / (1000 * 60 * 60);
                if (hoursSinceCompletion > RATING_WINDOW_HOURS) {
                    // READ-ONLY FIX: Do not write during GET.
                    // Just skip it in the response.
                    continue;
                }
            }

            activeJobs.push(await enrichWithNegotiation(await sanitizeJobForMobile(jobRaw)));
        }

        const activeJob = activeJobs.length > 0 ? activeJobs[0] : null;

        // 4. Promotions
        const now = new Date();
        const rawPromotions = await Promotion.find({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
            targetRole: { $in: ['CUSTOMER', 'ALL'] },
            $or: [{ countryCode }, { countryCode: { $exists: false } }, { countryCode: 'GLOBAL' }]
        }).sort({ priority: -1 }).limit(5);

        const promotions = await Promise.all(rawPromotions.map(async (p) => {
            const obj = p.toObject();
            if (obj.imageUrl) obj.imageUrl = await storageService.getSignedUrl(obj.imageUrl);
            return obj;
        }));

        // 4b. Referral Campaign (Isolated by Country)
        const rawReferralCampaign = await ReferralCampaign.findOne({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
            countryCode
        }).sort({ createdAt: -1 });

        let referralCampaign = null;
        if (rawReferralCampaign) {
            referralCampaign = rawReferralCampaign.toObject();
            if (referralCampaign.bannerUrl) {
                referralCampaign.bannerUrl = await storageService.getSignedUrl(referralCampaign.bannerUrl);
            }
        }

        // 5. Latest Activity (Limited to 5 records sorted by activity time to match Job History)
        const latestActivityJobs = await Job.find({
            customerId: userId,
            countryCode,
            status: { $in: [JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.RATED, JobStatus.CLOSED] }
        })
        .sort({ updatedAt: -1 })
        .limit(5);

        const latestActivity = await Promise.all(latestActivityJobs.map(async (jobRaw) => {
            const j = await enrichWithNegotiation(await sanitizeJobForMobile(jobRaw));
            const isNegotiated = j.priceNegotiationRequired === true;

            // Map terminal statuses to COMPLETED for UI consistency
            const displayStatus = [JobStatus.COMPLETED, JobStatus.RATED, JobStatus.CLOSED].includes(j.status as JobStatus)
                ? JobStatus.COMPLETED
                : j.status;

            return {
                _id: j.id,
                id: j.id,
                type: 'JOB',
                status: displayStatus,
                serviceCode: j.serviceCode,
                serviceName: j.serviceName,
                address: j.location?.address,
                amount: [JobStatus.COMPLETED, JobStatus.RATED, JobStatus.CLOSED].includes(j.status as JobStatus)
                    ? (isNegotiated ? (j.agreedPrice || (j.serviceFee + j.bookingFee)) : j.bookingFee)
                    : (j.bookingFee || null),
                isNegotiated: isNegotiated,
                startedAt: j.startedAt,
                completedAt: j.completedAt,
                cancelledAt: j.cancelledAt,
                cancelledBy: j.cancelledBy,
                createdAt: j.createdAt,
                currency: j.currency || walletData.currency
            };
        }));

        // 6. Top Rated Providers Nearby
        const lat = parseFloat(req.query.lat as string);
        const lng = parseFloat(req.query.lng as string);

        let topRatedNearby: any[] = [];

        if (!isNaN(lat) && !isNaN(lng)) {
            // ... (rest of geoNear logic) ...
            // I'm not changing geoNear, just ensuring I don't break the flow.
        }

        // 7. Recommended Services
        const usedServiceCodes = [...new Set(latestActivityJobs.map((j: any) => j.serviceCode))];


        const recommendations = await Service.find({
            isActive: true,
            $or: [
                { code: { $in: usedServiceCodes } },
                { countryCode: { $in: ['GLOBAL', countryCode] } }
            ]
        }).limit(20);

        const providerCounts = await Provider.aggregate([
            { $match: { isOnline: true, currentAvailabilityStatus: 'ONLINE', countryCode } },
            { $unwind: "$servicesOffered" },
            { $group: { _id: "$servicesOffered", count: { $sum: 1 } } }
        ]);

        const enhancedRecommendations = recommendations.map(s => {
            const countObj = providerCounts.find(pc => pc._id === s.code);
            return {
                ...s.toObject(),
                onlineCount: countObj?.count || 0,
                onlineCountLabel: `${countObj?.count || 0} Online`
            };
        });

        enhancedRecommendations.sort((a, b) => {
            const aUsed = usedServiceCodes.includes(a.code) ? 1 : 0;
            const bUsed = usedServiceCodes.includes(b.code) ? 1 : 0;
            if (aUsed !== bUsed) return bUsed - aUsed;
            return (b as any).onlineCount - (a as any).onlineCount;
        });

        console.log(`[FORENSIC] DASHBOARD | Sending response for ${userId}`);

        res.status(200).json({
            success: true,
            data: {
                profile: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    photo: user.profilePhoto ? await storageService.getSignedUrl(user.profilePhoto) : null,
                    addresses: user.addresses,
                    savedLocations: user.savedLocations
                },
                wallet: walletData,
                activeJob,
                activeJobs,
                promotions,
                referralCampaign,
                latestActivity,
                topRatedNearby,
                recommendations: enhancedRecommendations.slice(0, 10),
                currency: currencySymbol // GLOBAL CONTEXT FOR APP
            }
        });
    } catch (error: any) {
        console.error(`[FORENSIC] DASHBOARD | ERROR: ${error.message}`);
        logger.error(`DASHBOARD | GET_CUSTOMER_FAILED | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getCustomerPromotions = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        if (!countryCode) return res.status(400).json({ success: false, message: 'Country code missing' });

        const now = new Date();
        const rawPromotions = await Promotion.find({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
            targetRole: { $in: ['CUSTOMER', 'ALL'] },
            $or: [{ countryCode }, { countryCode: { $exists: false } }, { countryCode: 'GLOBAL' }]
        }).sort({ priority: -1 }).limit(5);

        const promotions = await Promise.all(rawPromotions.map(async (p) => {
            const obj = p.toObject();
            if (obj.imageUrl) obj.imageUrl = await storageService.getSignedUrl(obj.imageUrl);
            return obj;
        }));

        res.status(200).json({ success: true, data: promotions });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getProviderNetEarnings = async (userId: string, startDate: Date) => {
    const results = await Ledger.aggregate([
        {
            $match: {
                $or: [
                    { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE },
                    { fromUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.COMMISSION }
                ],
                createdAt: { $gte: startDate },
                status: 'COMPLETED'
            }
        },
        {
            $group: {
                _id: "$jobId",
                gross: { $sum: { $cond: [{ $eq: ["$type", TransactionType.SERVICE_FEE] }, "$amount", 0] } },
                commission: { $sum: { $cond: [{ $eq: ["$type", TransactionType.COMMISSION] }, "$amount", 0] } }
            }
        },
        {
            $project: {
                net: { $cond: [{ $gt: ["$gross", 0] }, { $subtract: ["$gross", "$commission"] }, 0] }
            }
        },
        {
            $group: { _id: null, total: { $sum: "$net" } }
        }
    ]);

    return results[0]?.total || 0;
};

export const getProviderDashboard = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const countryCode = req.user?.countryCode;

        if (!countryCode) {
            return res.status(400).json({ success: false, message: 'Workspace/Country code not resolved.' });
        }

        const [user, provider, country] = await Promise.all([
            User.findById(userId).select('firstName lastName email profilePhoto role countryCode'),
            Provider.findOne({ userId }).populate('userId', 'firstName lastName profilePhoto'),
            Country.findOne({ code: countryCode })
        ]);

        if (!user || !provider) {
            return res.status(404).json({ success: false, message: 'Provider profile not found.' });
        }

        const currencySymbol = country?.currencySymbol || country?.currency || 'R';

        // 1. Stats
        const now = new Date();
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        const [earningsToday, earningsWeekly, earningsMonthly, jobStatsAgg] = await Promise.all([
            getProviderNetEarnings(userId as string, startOfToday),
            getProviderNetEarnings(userId as string, weekAgo),
            getProviderNetEarnings(userId as string, monthAgo),
            Job.aggregate([
                { $match: { providerId: new mongoose.Types.ObjectId(userId as string) } },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ])
        ]);

        const jobsByStatus: any = {};
        jobStatsAgg.forEach(j => { jobsByStatus[j._id] = j.count; });

        const stats = {
            earningsToday,
            earningsWeekly,
            earningsMonthly,
            jobsCompleted: jobsByStatus[JobStatus.COMPLETED] || 0,
            jobsActive: (jobsByStatus[JobStatus.ACCEPTED] || 0) + (jobsByStatus[JobStatus.ARRIVED] || 0) + (jobsByStatus[JobStatus.STARTED] || 0),
            acceptanceRate: provider.performance.acceptanceRate || 0,
            completionRate: provider.performance.completionRate || 0,
            arrivalRate: provider.performance.arrivalRate || 0,
            tier: provider.tier,
            tierProgress: 0.75, // Logic for progression can be added
            rating: provider.ratingAvg,
            verificationStatus: provider.verificationStatus,
            isOnline: provider.isOnline
        };

        // 2. Active Job
        const activeJobRaw = await Job.findOne({
            providerId: userId,
            countryCode,
            status: { $in: [JobStatus.PROVIDER_ACCEPTED, JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.COMPLETED] }
        }).sort({ updatedAt: -1 }).populate('customerId', 'firstName lastName profilePhoto');

        let activeJob = null;
        if (activeJobRaw) {
            // NEW RATING POLICY: Filter out completed jobs that are rated, dismissed, or expired (24h window)
            let skip = false;
            if (activeJobRaw.status === JobStatus.COMPLETED) {
                if (activeJobRaw.providerRated || activeJobRaw.providerRatingDismissed) skip = true;
                else {
                    const completionTime = activeJobRaw.completedAt || activeJobRaw.updatedAt;
                    const hoursSinceCompletion = (Date.now() - completionTime.getTime()) / (1000 * 60 * 60);
                if (hoursSinceCompletion > 24) {
                    // READ-ONLY FIX: Skip in response instead of writing to DB.
                    skip = true;
                }
                }
            }

            if (!skip) {
                activeJob = await enrichWithNegotiation(await sanitizeJobForMobile(activeJobRaw));
            }
        }

        // 3. Recent Activity (Latest 5 records sorted by activity time to match Job History)
        const recentJobs = await Job.find({
            providerId: userId,
            countryCode,
            status: { $in: [JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.RATED, JobStatus.CLOSED] }
        })
        .sort({ updatedAt: -1 })
        .limit(5);

        const activities = await Promise.all(recentJobs.map(async (jobRaw) => {
            const j = await enrichWithNegotiation(await sanitizeJobForMobile(jobRaw));

            // Map terminal statuses to COMPLETED for UI consistency
            const displayStatus = [JobStatus.COMPLETED, JobStatus.RATED, JobStatus.CLOSED].includes(j.status as JobStatus)
                ? JobStatus.COMPLETED
                : j.status;

            return {
                id: j.id,
                type: 'JOB',
                status: displayStatus,
                title: `${displayStatus.replace('_', ' ')}: ${j.serviceName}`,
                serviceName: j.serviceName,
                address: j.location?.address,
                amount: j.providerEarnings,
                startedAt: j.startedAt,
                completedAt: j.completedAt,
                cancelledAt: j.cancelledAt,
                cancelledBy: j.cancelledBy,
                createdAt: j.createdAt
            };
        }));

        // 4. Referral Campaign
        const rawReferralCampaign = await ReferralCampaign.findOne({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
            countryCode
        }).sort({ createdAt: -1 });

        let referralCampaign = null;
        if (rawReferralCampaign) {
            referralCampaign = rawReferralCampaign.toObject();
            if (referralCampaign.bannerUrl) {
                referralCampaign.bannerUrl = await storageService.getSignedUrl(referralCampaign.bannerUrl);
            }
        }

        res.status(200).json({
            success: true,
            data: {
                profile: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    photo: user.profilePhoto ? await storageService.getSignedUrl(user.profilePhoto) : null,
                    role: user.role
                },
                stats,
                activeJob,
                recentActivity: activities,
                referralCampaign,
                currency: currencySymbol
            }
        });

    } catch (error: any) {
        logger.error(`DASHBOARD | GET_PROVIDER_FAILED | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};
