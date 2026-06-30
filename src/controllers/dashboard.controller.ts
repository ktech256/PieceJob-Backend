import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User';
import Wallet from '../models/Wallet';
import Job, { JobStatus } from '../models/Job';
import Ledger from '../models/Ledger';
import Promotion from '../models/Promotion';
import Provider from '../models/Provider';
import Service from '../models/Service';
import * as storageService from '../services/storage.service';
import { logger } from '../utils/logger';

export const getCustomerDashboard = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const countryCode = req.user?.countryCode || 'ZA';

        // 1. User Profile ( firstName )
        const user = await User.findById(userId).select('firstName lastName email profilePhoto addresses savedLocations');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // 2. Wallet Balance
        const wallet = await Wallet.findOne({ userId });
        const walletData = {
            balanceMain: wallet?.balanceMain || 0,
            balanceCredit: wallet?.balanceCredit || 0,
            balanceReferral: wallet?.balanceReferral || 0,
            currency: wallet?.currency || 'USD'
        };

        // 3. Active Job
        const activeJob = await Job.findOne({
            customerId: userId,
            status: { $in: [JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.COMPLETED] }
        }).sort({ updatedAt: -1 }).populate('providerId', 'firstName lastName profilePhoto');

        // 4. Promotions (Active and Role matched)
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

        // 5. Latest Activity (Last 5 jobs or ledger entries)
        const recentJobs = await Job.find({ customerId: userId })
            .sort({ createdAt: -1 })
            .limit(5);

        const latestActivity = recentJobs.map(j => ({
            id: j._id,
            type: 'JOB',
            status: j.status,
            serviceCode: j.serviceCode,
            amount: j.bookingFee + (j.serviceFee || 0),
            createdAt: j.createdAt
        }));

        // 6. Top Rated Providers Nearby
        // In a real scenario, we'd use $near with customer current location if provided in query
        const lat = parseFloat(req.query.lat as string);
        const lng = parseFloat(req.query.lng as string);

        let topRatedNearby: any[] = [];
        const providerQuery: any = {
            isOnline: true,
            currentAvailabilityStatus: 'ONLINE',
            verificationStatus: 'APPROVED',
            countryCode
        };

        if (!isNaN(lat) && !isNaN(lng)) {
            providerQuery.location = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [lng, lat] },
                    $maxDistance: 50000 // 50km
                }
            };
        }

        const rawProviders = await Provider.find(providerQuery)
            .sort({ ratingAvg: -1 })
            .limit(10)
            .populate('userId', 'firstName lastName profilePhoto');

        topRatedNearby = await Promise.all(rawProviders.map(async (p) => {
            const u = p.userId as any;
            let photo = u?.profilePhoto;
            if (photo) photo = await storageService.getSignedUrl(photo);

            return {
                id: p._id,
                name: `${u?.firstName || ''} ${u?.lastName || ''}`.trim(),
                photo,
                rating: p.ratingAvg,
                tier: p.tier,
                services: p.servicesOffered,
                // distance would be calculated by $near but we don't have it in field unless using aggregation
            };
        }));

        // 7. Recommended Services
        // Logic: Services used before + popular services in country
        const usedServiceCodes = [...new Set(recentJobs.map(j => j.serviceCode))];
        const popularServices = await Service.find({
            countryCode,
            isActive: true,
            code: { $nin: usedServiceCodes }
        }).sort({ usageCount: -1 }).limit(5);

        const recommendations = await Service.find({
            code: { $in: usedServiceCodes },
            isActive: true
        });

        // Merge
        const finalRecommendations = [...recommendations, ...popularServices].slice(0, 6);

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
                latestActivity,
                topRatedNearby,
                recommendations: finalRecommendations
            }
        });
    } catch (error: any) {
        logger.error(`DASHBOARD | GET_CUSTOMER_FAILED | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};
