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
import { logger } from '../utils/logger';

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

        // 3. Active Job
        const activeJobRaw = await Job.findOne({
            customerId: userId,
            status: { $in: [JobStatus.PROVIDER_ACCEPTED, JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.COMPLETED] }
        }).sort({ updatedAt: -1 }).populate('providerId', 'firstName lastName profilePhoto');

        let activeJob = null;
        if (activeJobRaw) {
            const aj = activeJobRaw.toObject() as any;
            const p = aj.providerId as any;
            if (p && typeof p === 'object') {
                aj.providerId = p._id; // Restore as string to avoid Android parsing crash
                aj.providerInfo = {
                    firstName: p.firstName,
                    lastName: p.lastName,
                    profilePicture: p.profilePhoto ? await storageService.getSignedUrl(p.profilePhoto) : null,
                    ratingAvg: 0,
                    jobsCompleted: 0
                };
            }
            activeJob = await enrichWithNegotiation(aj);
        }

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
        const referralCampaign = await ReferralCampaign.findOne({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
            countryCode
        }).sort({ createdAt: -1 });

        // 5. Latest Activity (Limited to 3 records as per Issue 1)
        const recentJobs = await Job.find({ customerId: userId })
            .sort({ createdAt: -1 })
            .limit(3);

        const latestActivity = recentJobs.map(j => ({
            _id: j._id,
            id: j._id,
            type: 'JOB',
            status: j.status,
            serviceCode: j.serviceCode,
            serviceName: j.serviceName,
            amount: j.bookingFee + (j.serviceFee || 0),
            createdAt: j.createdAt,
            currency: walletData.currency // Attach currency for proper UI display
        }));

        // 6. Top Rated Providers Nearby
        const lat = parseFloat(req.query.lat as string);
        const lng = parseFloat(req.query.lng as string);

        let topRatedNearby: any[] = [];

        if (!isNaN(lat) && !isNaN(lng)) {
            // Use aggregation for distance + rating sorting
            const aggregatedProviders = await Provider.aggregate([
                {
                    $geoNear: {
                        near: { type: "Point", coordinates: [lng, lat] },
                        distanceField: "dist.calculated",
                        maxDistance: 50000,
                        query: { isOnline: true, currentAvailabilityStatus: 'ONLINE', verificationStatus: 'APPROVED', countryCode },
                        spherical: true
                    }
                },
                { $sort: { ratingAvg: -1, "dist.calculated": 1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: "users",
                        localField: "userId",
                        foreignField: "_id",
                        as: "user"
                    }
                },
                { $unwind: "$user" }
            ]);

            topRatedNearby = await Promise.all(aggregatedProviders.map(async (p) => {
                let photo = p.user.profilePhoto;
                if (photo) photo = await storageService.getSignedUrl(photo);

                return {
                    id: p._id,
                    name: `${p.user.firstName || ''} ${p.user.lastName || ''}`.trim(),
                    photo,
                    rating: p.ratingAvg,
                    tier: p.tier,
                    services: p.servicesOffered,
                    distance: p.dist.calculated
                };
            }));
        } else {
            // Fallback: No location, just sort by rating
            const rawProviders = await Provider.find({
                isOnline: true,
                currentAvailabilityStatus: 'ONLINE',
                verificationStatus: 'APPROVED',
                countryCode
            }).sort({ ratingAvg: -1 }).limit(10).populate('userId', 'firstName lastName profilePhoto');

            topRatedNearby = await Promise.all(rawProviders.map(async (p) => {
                const u = p.userId as any;
                if (!u) return null;
                let photo = u.profilePhoto;
                if (photo) photo = await storageService.getSignedUrl(photo);

                return {
                    id: p._id,
                    name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
                    photo,
                    rating: p.ratingAvg,
                    tier: p.tier,
                    services: p.servicesOffered
                };
            }));
            topRatedNearby = topRatedNearby.filter(p => p !== null);
        }

        // 7. Recommended Services
        const usedServiceCodes = [...new Set(recentJobs.map(j => j.serviceCode))];

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
            Ledger.aggregate([
                { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: startOfToday }, status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: weekAgo }, status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: monthAgo }, status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Job.aggregate([
                { $match: { providerId: new mongoose.Types.ObjectId(userId) } },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ])
        ]);

        const jobsByStatus: any = {};
        jobStatsAgg.forEach(j => { jobsByStatus[j._id] = j.count; });

        const stats = {
            earningsToday: earningsToday[0]?.total || 0,
            earningsWeekly: earningsWeekly[0]?.total || 0,
            earningsMonthly: earningsMonthly[0]?.total || 0,
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
            status: { $in: [JobStatus.PROVIDER_ACCEPTED, JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS] }
        }).sort({ updatedAt: -1 }).populate('customerId', 'firstName lastName profilePhoto');

        let activeJob = null;
        if (activeJobRaw) {
            const aj = activeJobRaw.toObject() as any;
            const c = aj.customerId as any;
            if (c && typeof c === 'object') {
                aj.customerId = c._id;
                aj.customerInfo = {
                    firstName: c.firstName,
                    lastName: c.lastName,
                    profilePicture: c.profilePhoto ? await storageService.getSignedUrl(c.profilePhoto) : null
                };
            }
            activeJob = await enrichWithNegotiation(aj);
        }

        // 3. Recent Activity (Latest 5)
        const [recentJobs, recentLedgers] = await Promise.all([
            Job.find({ providerId: userId }).sort({ createdAt: -1 }).limit(5),
            Ledger.find({ toUserId: userId }).sort({ createdAt: -1 }).limit(5)
        ]);

        const activities = [
            ...recentJobs.map(j => ({
                id: j._id,
                type: 'JOB',
                status: j.status,
                title: `${j.status.replace('_', ' ')}: ${j.serviceName || j.serviceCode}`,
                amount: j.serviceFee || 0,
                createdAt: j.createdAt
            })),
            ...recentLedgers.map(l => ({
                id: l._id,
                type: 'TRANSACTION',
                status: l.status,
                title: l.type.replace('_', ' '),
                amount: l.amount,
                createdAt: l.createdAt
            }))
        ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5);

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
                currency: currencySymbol
            }
        });

    } catch (error: any) {
        logger.error(`DASHBOARD | GET_PROVIDER_FAILED | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};
