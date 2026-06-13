import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Provider, { VerificationStatus } from '../models/Provider';
import User from '../models/User';
import Service from '../models/Service';
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
    res.status(200).json({
      success: true,
      data: provider
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch provider profile', error });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const {
            firstName, lastName, gender, dob, profilePhoto, city, address, emergencyContact
        } = req.body;

        // Update User Model (PII)
        await User.findByIdAndUpdate(userId, {
            firstName, lastName, gender, dob, profilePhoto, city, address, emergencyContact
        });

        // Fetch fresh profile
        const provider = await Provider.findOne({ userId }).populate('userId', '-passwordHash');

        res.status(200).json({ success: true, message: 'Profile updated successfully', data: provider });
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

        const services = await Service.find({ code: { $in: provider.servicesOffered } });
        res.status(200).json({ success: true, data: services });
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

        const services = await Service.find({ code: { $in: serviceCodes } });

        const approved: string[] = [];
        const pending: string[] = [];

        for (const s of services) {
            // Gender Check
            if (s.genderRule !== 'BOTH' && (s.genderRule as string) !== (provider.gender as string)) {
                continue; // Skip restricted
            }

            // Level Check
            const levels = ['STANDARD', 'PROFESSIONAL', 'TRADE', 'HIGH_VETTING'];
            const provLevelIdx = levels.indexOf(provider.verificationLevel);
            const servLevelIdx = levels.indexOf(s.verificationLevel);

            if (provLevelIdx >= servLevelIdx) {
                approved.push(s.code);
            } else {
                pending.push(s.code);
            }
        }

        provider.servicesOffered = approved;
        provider.pendingServices = pending;
        await provider.save();

        res.status(200).json({
            success: true,
            message: 'Services updated. Some may require further verification.',
            data: { approved, pending }
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
