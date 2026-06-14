import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Provider, { VerificationStatus } from '../models/Provider';
import User from '../models/User';
import Service, { ServiceCategory, VerificationLevel } from '../models/Service';
import { emitAdminUpdate } from '../socket/socket.service';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
import mongoose from 'mongoose';
import * as presenceService from '../services/provider-presence.service';

export const getProviderProfile = async (req: AuthRequest, res: Response) => {
  try {
    const provider = await Provider.findOne({ userId: req.user?.userId }).populate('userId', '-passwordHash');
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }

    // Ensure dob is formatted as string if needed, or let client handle it
    const profile = provider.toObject();

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
            // We ignore any attempts to change them
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

                // PAGE 12: Audit Log for address change request
                console.log(`[AUDIT] Address change requested for verified provider ${userId}`);
            } else {
                // Not verified yet, can change directly
                if (city) user.city = city;
                if (province) user.province = province;
                if (address) user.address = address;
            }
        }

        if (profilePhoto) user.profilePhoto = profilePhoto;
        if (emergencyContact) user.emergencyContact = emergencyContact;

        await user.save();

        // Refresh and return
        const updatedProvider = await Provider.findOne({ userId }).populate('userId', '-passwordHash');

        res.status(200).json({ success: true, message: 'Profile updated successfully', data: updatedProvider });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update profile', error });
    }
};

export const updateStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { isOnline } = req.body;
    const provider = await Provider.findOneAndUpdate(
      { userId: req.user?.userId },
      { isOnline, lastHeartbeat: new Date() },
      { new: true }
    );

    emitAdminUpdate('provider_status_changed', {
        userId: req.user?.userId,
        isOnline: provider?.isOnline,
        timestamp: new Date()
    });

    res.status(200).json({ success: true, isOnline: provider?.isOnline });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Status update failed', error });
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

export const getMyServices = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        // Populate both approved and pending services, isolating by country/global
        const approved = await Service.find({
            code: { $in: provider.servicesOffered },
            $or: [{ countryCode: provider.countryCode }, { countryCode: 'GLOBAL' }]
        });
        const pending = await Service.find({
            code: { $in: provider.pendingServices },
            $or: [{ countryCode: provider.countryCode }, { countryCode: 'GLOBAL' }]
        });

        res.status(200).json({
            success: true,
            data: {
                approved,
                pending
            }
        });
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
            // Gender Check (RC-2 Rule Alignment - Strict Enforcement)
            // Provider Gender B (Both) can take any service
            if (provider.gender !== 'B') {
                if (s.genderRule === 'MEN_ONLY' && provider.gender === 'F') {
                    return res.status(403).json({
                        success: false,
                        message: `Service '${s.name}' is for Male providers only.`
                    });
                }
                if (s.genderRule === 'WOMEN_ONLY' && provider.gender === 'M') {
                    return res.status(403).json({
                        success: false,
                        message: `Service '${s.name}' is for Female providers only.`
                    });
                }
            }

            // Level Check
            const levels = ['STANDARD', 'PROFESSIONAL', 'TRADE', 'HIGH_VETTING'];
            const provLevelIdx = levels.indexOf(provider.verificationLevel);

            // Respect Dashboard Verification Requirement strictly (RC-2 Fix)
            let effectiveServLevel: string = s.verificationLevel;
            const servLevelIdx = levels.indexOf(effectiveServLevel);

            // RC-2: Verification Level Persistence Logic
            // If provider is already approved at this level or higher, approve immediately
            if (provider.verificationStatus === 'APPROVED' && provLevelIdx >= servLevelIdx) {
                approved.push(s.code);
            } else {
                pending.push(s.code);

                // Build requirements for pending services (Strictly Additive)
                let requiredDocs: string[] = ['GOVERNMENT_ID', 'SELFIE'];

                // Additive logic for preview
                if (levels.indexOf(effectiveServLevel) >= levels.indexOf('PROFESSIONAL')) {
                    requiredDocs.push('CERTIFICATION', 'EXPERIENCE_VERIFICATION');
                }
                if (levels.indexOf(effectiveServLevel) >= levels.indexOf('TRADE')) {
                    requiredDocs.push('TRADE_LICENSE', 'TOOL_VERIFICATION');
                }
                if (levels.indexOf(effectiveServLevel) >= levels.indexOf('HIGH_VETTING')) {
                    requiredDocs.push('CRIMINAL_CHECK', 'INTERVIEW', 'REFERENCES');
                }

                requirements[s.code] = {
                    level: effectiveServLevel,
                    docs: [...new Set(requiredDocs)]
                };
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

        const earningsToday = await Ledger.aggregate([
            { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: startOfToday }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const earningsWeekly = await Ledger.aggregate([
            { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: weekAgo }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const earningsMonthly = await Ledger.aggregate([
            { $match: { toUserId: new mongoose.Types.ObjectId(userId), type: TransactionType.SERVICE_FEE, createdAt: { $gte: monthAgo }, status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const jobs = await Job.aggregate([
            { $match: { providerId: new mongoose.Types.ObjectId(userId) } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        const jobsByStatus: any = {};
        jobs.forEach(j => { jobsByStatus[j._id] = j.count; });

        res.status(200).json({
            success: true,
            data: {
                earningsToday: earningsToday[0]?.total || 0,
                earningsWeekly: earningsWeekly[0]?.total || 0,
                earningsMonthly: earningsMonthly[0]?.total || 0,
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
        console.error('[STATS_ERROR]', error);
        res.status(500).json({ success: false, message: 'Stats failed', error });
    }
};
