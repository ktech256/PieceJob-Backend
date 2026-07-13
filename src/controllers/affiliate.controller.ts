import { Request, Response } from 'express';
import AffiliatePartner, { AffiliateStatus } from '../models/AffiliatePartner';
import ReferralRecord from '../models/ReferralRecord';
import ReferralReward from '../models/ReferralReward';
import Ledger, { TransactionType } from '../models/Ledger';
import Notification from '../models/Notification';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as notificationQueue from '../services/notification.queue';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

export const loginPartner = async (req: Request, res: Response) => {
    try {
        const { identifier, password } = req.body;
        const partner = await AffiliatePartner.findOne({
            $or: [
                { email: identifier.toLowerCase() },
                { phone: identifier }
            ]
        });

        if (!partner || partner.status === AffiliateStatus.SUSPENDED) {
            return res.status(401).json({ success: false, message: 'Invalid credentials or account suspended' });
        }

        const isMatch = await bcrypt.compare(password, partner.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { partnerId: partner._id, role: 'PARTNER', countryCode: partner.countryCode },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '24h' }
        );

        res.status(200).json({
            success: true,
            token,
            partner: {
                id: partner._id,
                name: partner.name,
                referralCode: partner.referralCode,
                countryCode: partner.countryCode
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPartnerDashboard = async (req: Request, res: Response) => {
    try {
        const partnerId = (req as any).user?.partnerId;
        const partner = await AffiliatePartner.findById(partnerId);
        if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

        res.status(200).json({
            success: true,
            data: {
                stats: partner.stats,
                balance: partner.balance,
                referralCode: partner.referralCode,
                name: partner.name,
                status: partner.status,
                countryCode: partner.countryCode
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPartnerStatements = async (req: Request, res: Response) => {
    try {
        const partnerId = (req as any).user?.partnerId;
        // Search Ledger for rewards or payouts to this partner
        const entries = await Ledger.find({
            toUserId: partnerId,
            type: { $in: [TransactionType.REFERRAL_REWARD, TransactionType.PAYOUT] }
        }).sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: entries });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPartnerReports = async (req: Request, res: Response) => {
    try {
        const partnerId = (req as any).user?.partnerId;

        // Aggregate stats per campaign or period
        const records = await ReferralRecord.find({ referrerId: partnerId });
        const rewards = await ReferralReward.find({ referrerId: partnerId });

        // Simple monthly aggregation
        const monthlyStats = await ReferralReward.aggregate([
            { $match: { referrerId: new mongoose.Types.ObjectId(partnerId), status: 'REWARDED' } },
            {
                $group: {
                    _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } },
                    totalEarned: { $sum: "$amount" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": -1, "_id.month": -1 } }
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalReferrals: records.length,
                qualifiedCount: records.filter(r => r.jobsCompletedCount > 0).length,
                monthlyStats
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPartnerNotifications = async (req: Request, res: Response) => {
    try {
        const partnerId = (req as any).user?.partnerId;
        const notifications = await Notification.find({ userId: partnerId }).sort({ createdAt: -1 }).limit(50);
        res.status(200).json({ success: true, data: notifications });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updatePartnerProfile = async (req: Request, res: Response) => {
    try {
        const partnerId = (req as any).user?.partnerId;
        const { email, phone, name } = req.body;

        const partner = await AffiliatePartner.findByIdAndUpdate(partnerId, {
            email, phone, name
        }, { new: true });

        res.status(200).json({ success: true, data: partner });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createPartner = async (req: Request, res: Response) => {
    try {
        const { name, email, phone, type, countryCode, commissionModel, commissionValue, password } = req.body;

        const passwordHash = await bcrypt.hash(password || 'PJPartner2024!', 10);
        const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();

        const partner = new AffiliatePartner({
            ...req.body,
            passwordHash,
            referralCode
        });

        await partner.save();

        // Dispatch Welcome Partner Email
        await notificationQueue.addNotificationToQueue({
            type: 'EMAIL',
            email: partner.email,
            templateCode: 'WELCOME_PARTNER',
            templateData: {
                name: partner.name,
                referralCode: partner.referralCode,
                password: password || 'PJPartner2024!'
            },
            countryCode: partner.countryCode
        });

        res.status(201).json({ success: true, data: partner });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPartners = async (req: Request, res: Response) => {
    try {
        const { countryCode } = req.query;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const partners = await AffiliatePartner.find(query).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: partners });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
