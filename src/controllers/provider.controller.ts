import admin from 'firebase-admin';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Provider, { VerificationStatus } from '../models/Provider';
import User from '../models/User';
import Service, { ServiceCategory, VerificationLevel } from '../models/Service';
import { emitAdminUpdate } from '../socket/socket.service';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
import SystemSettings from '../models/SystemSettings';
import mongoose from 'mongoose';
import * as presenceService from '../services/provider-presence.service';
import * as storageService from '../services/storage.service';
import { logger } from '../utils/logger';

export const getProviderProfile = async (req: AuthRequest, res: Response) => {
  try {
    const provider = await Provider.findOne({ userId: req.user?.userId }).populate('userId', '-passwordHash');
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }

    const profile: any = provider.toObject();

    // Signed URLs for docs in profile
    if (profile.userId?.profilePhoto) {
        profile.userId.profilePhoto = await storageService.getSignedUrl(profile.userId.profilePhoto);
    }

    if (profile.documents) {
        profile.documents = await Promise.all(profile.documents.map(async (d: any) => ({
            ...d,
            url: await storageService.getSignedUrl(d.url)
        })));
    }

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch provider profile', error });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const {
            firstName, lastName, gender, dob, profilePhoto, city, province, address, emergencyContact, proofOfResidenceUrl
        } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const provider = await Provider.findOne({ userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const isVerified = provider.verificationStatus === 'APPROVED';

        // 1. Lock Verified Fields (Section 1)
        if (isVerified) {
            // These fields cannot be changed if verified
        } else {
            if (firstName) user.firstName = firstName;
            if (lastName) user.lastName = lastName;
            if (gender) user.gender = gender;
            if (dob) user.dob = dob;
        }

        // 2. Address Reverification Logic (Section 1)
        if (city || province || address) {
            if (isVerified) {
                // If verified, address changes go to pending
                user.pendingAddress = {
                    province: province || user.province || '',
                    city: city || user.city || '',
                    address: address || user.address || '',
                    proofOfResidenceUrl: proofOfResidenceUrl || '',
                    submittedAt: new Date(),
                    status: 'PENDING'
                };
                logger.info(`PROVIDER | PROFILE_UPDATE | Address change requested for verified provider ${userId}`);
            } else {
                if (city) user.city = city;
                if (province) user.province = province;
                if (address) user.address = address;
            }
        }

        if (profilePhoto) user.profilePhoto = profilePhoto;
        if (emergencyContact) user.emergencyContact = emergencyContact;

        await user.save();

        const updatedProvider = await Provider.findOne({ userId }).populate('userId', '-passwordHash');
        res.status(200).json({ success: true, message: 'Profile updated successfully', data: updatedProvider });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update profile', error });
    }
};

export const updateAvailability = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOneAndUpdate(
            { userId: req.user?.userId },
            { availability: req.body },
            { new: true }
        );
        res.status(200).json({ success: true, data: provider?.availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed', error });
    }
};

export const getAvailability = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId }).select('availability');
        res.status(200).json({ success: true, data: provider?.availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fetch failed', error });
    }
};

export const getMyReviews = async (req: AuthRequest, res: Response) => {
    try {
        const reviews = await mongoose.model('Review').find({ providerId: req.user?.userId })
            .populate('customerId', 'firstName lastName profilePhoto')
            .sort({ createdAt: -1 });

        const formatted = reviews.map((r: any) => ({
            id: r._id,
            jobId: r.jobId,
            rating: r.rating,
            comment: r.comment,
            reviewerName: `${r.customerId.firstName} ${r.customerId.lastName}`,
            reviewerPhoto: r.customerId.profilePhoto,
            createdAt: r.createdAt
        }));

        res.status(200).json({ success: true, data: formatted });
    } catch (error) {
        res.status(200).json({ success: true, data: [] });
    }
};

export const updateStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { isOnline, coordinates } = req.body;
    const userId = req.user?.userId;

    const provider = await Provider.findOne({ userId });
    if (!provider) {
        return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }

    if (isOnline) {
        // 1. Account approved and verified
        if (provider.verificationStatus !== VerificationStatus.APPROVED) {
            return res.status(403).json({ success: false, message: 'Account not approved. Please complete verification.' });
        }

        // 3. At least one active service
        if (!provider.servicesOffered || provider.servicesOffered.length === 0) {
            return res.status(403).json({ success: false, message: 'Please configure at least one active service.' });
        }

        // 6. Not suspended
        if (provider.suspendedUntil && provider.suspendedUntil > new Date()) {
            return res.status(403).json({ success: false, message: 'Your account is currently suspended.' });
        }

        // 7. Not busy on another job
        const activeJob = await Job.findOne({
            providerId: userId,
            status: { $in: [JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED] }
        });
        if (activeJob) {
            return res.status(403).json({ success: false, message: 'You cannot go online while on an active job.' });
        }

        // 5. GPS location available
        if (coordinates) {
            provider.location.coordinates = coordinates;
            provider.lastGpsUpdate = new Date();
        } else if (!provider.location.coordinates || provider.location.coordinates.length === 0) {
            return res.status(400).json({ success: false, message: 'GPS location is required to go online.' });
        }

        provider.isOnline = true;
        provider.currentAvailabilityStatus = 'ONLINE';
        provider.lastOnlineAt = new Date();
    } else {
        provider.isOnline = false;
        provider.currentAvailabilityStatus = 'OFFLINE';
    }

    await provider.save();

    emitAdminUpdate('provider_status_changed', {
        userId: userId,
        isOnline: provider.isOnline,
        status: provider.currentAvailabilityStatus,
        timestamp: new Date()
    });

    res.status(200).json({
        success: true,
        isOnline: provider.isOnline,
        status: provider.currentAvailabilityStatus
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Status update failed', error });
  }
};

export const getOnlineProviders = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode || 'ZA';
        const lat = req.query.lat ? parseFloat(req.query.lat as string) : null;
        const lng = req.query.lng ? parseFloat(req.query.lng as string) : null;

        const settings = await SystemSettings.findOne({ countryCode });
        const radiusKm = settings?.matchingRadiusKm || 5;

        const query: any = {
            countryCode,
            isOnline: true,
            currentAvailabilityStatus: 'ONLINE',
            verificationStatus: 'APPROVED'
        };

        if (lat !== null && lng !== null) {
            query.location = {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    },
                    $maxDistance: radiusKm * 1000
                }
            };
        }

        const providers = await Provider.find(query).select('userId ratingAvg jobsCompleted location');

        const populated = await User.populate(providers, { path: 'userId', select: 'firstName lastName profilePhoto' });

        const formatted = populated.map((p: any) => ({
            id: p._id,
            userId: p.userId._id,
            firstName: p.userId.firstName,
            lastName: p.userId.lastName,
            ratingAvg: p.ratingAvg,
            jobsCompleted: p.jobsCompleted,
            location: p.location,
            isOnline: p.isOnline
        }));

        res.status(200).json({ success: true, data: formatted });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch online providers', error });
    }
};

export const handleHeartbeat = async (req: AuthRequest, res: Response) => {
    try {
        const { coordinates, hardwareId, isMockLocation } = req.body;
        await presenceService.handleHeartbeat(req.user?.userId as string, coordinates, hardwareId, isMockLocation);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Heartbeat failed', error });
    }
};

export const uploadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { type, url } = req.body;
    const provider = await Provider.findOneAndUpdate(
      { userId: req.user?.userId },
      { $push: { documents: { type, url, status: VerificationStatus.PENDING } } },
      { new: true }
    );
    res.status(200).json({ success: true, message: 'Document uploaded', provider });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Document upload failed', error });
  }
};

export const uploadFile = async (req: AuthRequest, res: Response) => {
  try {
    const { base64, mimeType, folder } = req.body;
    if (!base64) return res.status(400).json({ success: false, message: 'No file data provided' });

    const cleanBase64 = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;
    const path = await storageService.uploadBase64File(cleanBase64, folder || 'documents', mimeType || 'image/jpeg');

    res.status(200).json({ success: true, data: { url: path } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyServices = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const approved = await Service.find({
            code: { $in: provider.servicesOffered },
            $or: [{ countryCode: provider.countryCode }, { countryCode: 'GLOBAL' }]
        });
        const pending = await Service.find({
            code: { $in: provider.pendingServices },
            $or: [{ countryCode: provider.countryCode }, { countryCode: 'GLOBAL' }]
        });

        res.status(200).json({ success: true, data: { approved, pending } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch services', error });
    }
};

export const updateServices = async (req: AuthRequest, res: Response) => {
    try {
        const { serviceCodes } = req.body;
        const userId = req.user?.userId;

        const provider = await Provider.findOne({ userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const services = await Service.find({
            code: { $in: serviceCodes },
            $or: [{ countryCode: provider.countryCode }, { countryCode: 'GLOBAL' }]
        });

        const approved: string[] = [];
        const pending: string[] = [];
        const requirements: any = {};

        for (const s of services) {
            if (provider.gender !== 'B') {
                if (s.genderRule === 'MEN_ONLY' && provider.gender === 'F') {
                    return res.status(403).json({ success: false, message: `Service '${s.name}' is for Male providers only.` });
                }
                if (s.genderRule === 'WOMEN_ONLY' && provider.gender === 'M') {
                    return res.status(403).json({ success: false, message: `Service '${s.name}' is for Female providers only.` });
                }
            }

            const levels = ['STANDARD', 'PROFESSIONAL', 'TRADE', 'HIGH_VETTING'];
            const provLevelIdx = levels.indexOf(provider.verificationLevel);
            const servLevelIdx = levels.indexOf(s.verificationLevel);

            if (provider.verificationStatus === 'APPROVED' && provLevelIdx >= servLevelIdx) {
                approved.push(s.code);
            } else {
                pending.push(s.code);
                let requiredDocs: string[] = ['GOVERNMENT_ID', 'SELFIE'];
                if (servLevelIdx >= levels.indexOf('PROFESSIONAL')) requiredDocs.push('CRIMINAL_CHECK', 'CERTIFICATION', 'EXPERIENCE_VERIFICATION');
                if (servLevelIdx >= levels.indexOf('TRADE')) requiredDocs.push('TRADE_LICENSE', 'TOOL_VERIFICATION');
                if (servLevelIdx >= levels.indexOf('HIGH_VETTING')) requiredDocs.push('INTERVIEW', 'REFERENCES');

                requirements[s.code] = { level: s.verificationLevel, docs: [...new Set(requiredDocs)] };
            }
        }

        provider.servicesOffered = approved;
        provider.pendingServices = pending;
        await provider.save();

        res.status(200).json({
            success: true,
            message: pending.length > 0 ? 'Some services require further verification.' : 'Services updated successfully.',
            data: { approved, pending, requirements }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update services', error });
    }
};

export const getEquipment = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        res.status(200).json({ success: true, data: provider?.equipment || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch equipment', error });
    }
};

export const addEquipment = async (req: AuthRequest, res: Response) => {
    try {
        const { name, category, photoUrl } = req.body;
        const provider = await Provider.findOneAndUpdate(
            { userId: req.user?.userId },
            { $push: { equipment: { name, category, photoUrl, isVerified: false } } },
            { new: true }
        );
        res.status(201).json({ success: true, data: provider?.equipment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add equipment', error });
    }
};

export const getCertifications = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        res.status(200).json({ success: true, data: provider?.certifications || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch certifications', error });
    }
};

export const addCertification = async (req: AuthRequest, res: Response) => {
    try {
        const { name, institution, certificateNumber, expiryDate, photoUrl } = req.body;
        const provider = await Provider.findOneAndUpdate(
            { userId: req.user?.userId },
            { $push: { certifications: { name, institution, certificateNumber, expiryDate, photoUrl, status: VerificationStatus.PENDING } } },
            { new: true }
        );
        res.status(201).json({ success: true, data: provider?.certifications });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add certification', error });
    }
};

export const getExperience = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        res.status(200).json({ success: true, data: provider?.workExperience || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch experience', error });
    }
};

export const addExperience = async (req: AuthRequest, res: Response) => {
    try {
        const { companyName, role, startDate, endDate, description, referenceName, referencePhone } = req.body;
        const provider = await Provider.findOneAndUpdate(
            { userId: req.user?.userId },
            { $push: { workExperience: { companyName, role, startDate, endDate, description, referenceName, referencePhone } } },
            { new: true }
        );
        res.status(201).json({ success: true, data: provider?.workExperience });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add experience', error });
    }
};

export const getBankDetails = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        res.status(200).json({ success: true, data: provider?.bankDetails });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch bank details', error });
    }
};

export const updateBankDetails = async (req: AuthRequest, res: Response) => {
    try {
        const { bankName, accountHolder, accountNumber, branchCode, accountType, bankConfirmationUrl } = req.body;
        const provider = await Provider.findOneAndUpdate(
            { userId: req.user?.userId },
            {
                bankDetails: {
                    bankName,
                    accountHolder,
                    accountNumberEncrypted: accountNumber,
                    branchCode,
                    accountType,
                    bankConfirmationUrl,
                    isVerified: false
                }
            },
            { new: true }
        );
        res.status(200).json({ success: true, message: 'Bank details updated for review', data: provider?.bankDetails });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update bank details', error });
    }
};

export const updateWalletSettings = async (req: AuthRequest, res: Response) => {
    try {
        const { frequency, method } = req.body;
        const provider = await Provider.findOneAndUpdate(
            { userId: req.user?.userId },
            { payoutPreferences: { frequency, method } },
            { new: true }
        );
        res.status(200).json({ success: true, data: provider?.payoutPreferences });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update wallet settings', error });
    }
};

export const updateNotificationSettings = async (req: AuthRequest, res: Response) => {
    try {
        const settings = req.body;
        const provider = await Provider.findOneAndUpdate(
            { userId: req.user?.userId },
            { notificationSettings: settings },
            { new: true }
        );
        res.status(200).json({ success: true, data: provider?.notificationSettings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update notification settings', error });
    }
};

export const getMyJobs = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { status } = req.query;

        const query: any = { providerId: userId };
        if (status) {
            query.status = status === 'ACTIVE'
                ? { $in: [JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS] }
                : status;
        }

        const jobs = await Job.find(query)
            .sort({ createdAt: -1 })
            .populate('customerId', 'firstName lastName profilePhoto phoneNumber')
            .limit(100);

        const formatted = await Promise.all(jobs.map(async (j) => {
            const obj: any = j.toObject();
            if (obj.customerId && typeof obj.customerId === 'object') {
                if (obj.customerId.profilePhoto) {
                    obj.customerId.profilePicture = await storageService.getSignedUrl(obj.customerId.profilePhoto);
                }
                obj.customerInfo = {
                    firstName: obj.customerId.firstName,
                    lastName: obj.customerId.lastName,
                    profilePicture: obj.customerId.profilePicture,
                    phoneNumber: obj.customerId.phoneNumber
                };
            }
            return {
                ...obj,
                id: obj._id.toString(),
                serviceName: obj.serviceName || obj.serviceCode
            };
        }));

        res.status(200).json({ success: true, data: formatted });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch jobs', error });
    }
};

import * as performanceService from '../services/provider-performance.service';
import PerformanceAdjustment from '../models/PerformanceAdjustment';
import ProviderAppeal from '../models/ProviderAppeal';
import ProviderBadge from '../models/ProviderBadge';

export const getPerformanceHistory = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { period } = req.query; // 7d, 30d, 90d, all

        const provider = await Provider.findOne({ userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        let startDate = new Date(0);
        if (period === '7d') startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        else if (period === '30d') startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        else if (period === '90d') startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

        const adjustments = await PerformanceAdjustment.find({
            providerId: provider._id,
            createdAt: { $gte: startDate }
        }).sort({ createdAt: -1 }).populate('jobId', 'serviceName status');

        res.status(200).json({ success: true, data: adjustments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch performance history', error });
    }
};

export const submitAppeal = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { adjustmentId, ledgerId, reasonCode, description, evidence, gpsData } = req.body;

        const provider = await Provider.findOne({ userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const appeal = new ProviderAppeal({
            providerId: provider._id,
            userId,
            adjustmentId,
            ledgerId,
            reasonCode,
            description,
            evidence,
            gpsData
        });

        await appeal.save();

        // Emit to admin dashboard
        emitAdminUpdate('new_appeal_submitted', { appealId: appeal._id, providerId: provider._id });

        res.status(201).json({ success: true, message: 'Appeal submitted successfully', appeal });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Appeal submission failed', error: error.message });
    }
};

export const getMyBadges = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const badges = await ProviderBadge.find({ providerId: provider._id }).sort({ earnedAt: -1 });
        res.status(200).json({ success: true, data: badges });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch badges', error });
    }
};

export const getAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { period } = req.query;

        const provider = await Provider.findOne({ userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const analytics = await performanceService.getProviderAnalytics(provider._id.toString(), period as any || '30d');
        res.status(200).json({ success: true, data: analytics });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch analytics', error });
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

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const now = new Date();
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        const provider = await Provider.findOne({ userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const [earningsToday, earningsWeekly, earningsMonthly, jobsAgg] = await Promise.all([
            getProviderNetEarnings(userId as string, startOfToday),
            getProviderNetEarnings(userId as string, weekAgo),
            getProviderNetEarnings(userId as string, monthAgo),
            Job.aggregate([
                { $match: { providerId: new mongoose.Types.ObjectId(userId as string) } },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ])
        ]);

        const jobsByStatus: any = {};
        jobsAgg.forEach(j => { jobsByStatus[j._id] = j.count; });

        res.status(200).json({
            success: true,
            data: {
                earningsToday,
                earningsWeekly,
                earningsMonthly,
                jobsCompleted: jobsByStatus[JobStatus.COMPLETED] || 0,
                jobsActive: (jobsByStatus[JobStatus.ACCEPTED] || 0) + (jobsByStatus[JobStatus.ARRIVED] || 0) + (jobsByStatus[JobStatus.STARTED] || 0),
                acceptanceRate: provider.performance.acceptanceRate,
                completionRate: provider.performance.completionRate,
                arrivalRate: provider.performance.arrivalRate,
                tier: provider.tier,
                tierProgress: 0.75,
                rating: provider.ratingAvg,
                verificationStatus: provider.verificationStatus,
                isGhostMode: false
            }
        });
    } catch (error) {
        logger.error(`PROVIDER | DASHBOARD_STATS_FAILED | User: ${req.user?.userId} | Error: ${error}`);
        res.status(500).json({ success: false, message: 'Stats failed', error });
    }
};
