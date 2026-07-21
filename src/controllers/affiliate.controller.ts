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
    logger.info(`[AFFILIATE] Onboarding Request Received: ${req.body.email}`);
    try {
        const { name, email, phone, type, contactPerson, countryCode, commissionModel, commissionValue, password } = req.body;

        // 1. Structural Validation
        if (!name || !email || !phone || !type || !contactPerson || !countryCode || !commissionValue) {
            logger.warn(`[AFFILIATE] Validation Failed: Missing required fields in request`);
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: Partner Name, Email, Phone, Type, Contact Person, and Commission Value are mandatory.'
            });
        }

        // 2. Duplicate Check
        const existing = await AffiliatePartner.findOne({
            $or: [
                { email: email.toLowerCase() },
                { phone }
            ]
        });

        if (existing) {
            const field = existing.email === email.toLowerCase() ? 'Email' : 'Phone';
            logger.warn(`[AFFILIATE] Onboarding Failed: Duplicate ${field} (${existing.email}/${existing.phone})`);
            return res.status(409).json({
                success: false,
                message: `This ${field.toLowerCase()} is already associated with an existing partner.`
            });
        }

        const passwordHash = await bcrypt.hash(password || 'PJPartner2024!', 10);
        const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();

        const partner = new AffiliatePartner({
            ...req.body,
            email: email.toLowerCase(),
            passwordHash,
            referralCode
        });

        await partner.save();
        logger.info(`[AFFILIATE] Partner Entity Created: ${partner._id} | Code: ${referralCode}`);

        // 3. Dispatch Welcome Partner Email (Fire and forget, don't block response)
        notificationQueue.addNotificationToQueue({
            type: 'EMAIL',
            email: partner.email,
            templateCode: 'WELCOME_PARTNER',
            templateData: {
                name: partner.name,
                referralCode: partner.referralCode,
                password: password || 'PJPartner2024!'
            },
            countryCode: partner.countryCode
        }).catch(err => {
            logger.error(`[AFFILIATE] Welcome Email Dispatch Failed for ${partner.email}`, err);
        });

        res.status(201).json({ success: true, data: partner });
    } catch (error: any) {
        logger.error(`[AFFILIATE] Onboarding Execution Error`, error);
        res.status(500).json({ success: false, message: error.message || 'An unexpected error occurred during partner onboarding.' });
    }
};

export const getPartners = async (req: Request, res: Response) => {
    try {
        const { countryCode, search, status } = req.query;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { referralCode: { $regex: search, $options: 'i' } }
            ];
        }

        // Aggregate performance for each partner
        const partners = await AffiliatePartner.aggregate([
            { $match: query },
            {
                $lookup: {
                    from: 'referralrecords',
                    localField: '_id',
                    foreignField: 'referrerId',
                    as: 'referralDocs'
                }
            },
            {
                $lookup: {
                    from: 'referralrewards',
                    localField: '_id',
                    foreignField: 'referrerId',
                    as: 'rewardDocs'
                }
            },
            {
                $addFields: {
                    totalReferrals: { $size: "$referralDocs" },
                    activeReferrals: {
                        $size: {
                            $filter: {
                                input: "$referralDocs",
                                as: "r",
                                cond: { $eq: ["$$r.isDisabled", false] }
                            }
                        }
                    },
                    earningsLifetime: { $sum: "$rewardDocs.amount" },
                    pendingCommission: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: "$rewardDocs",
                                        as: "rw",
                                        cond: { $eq: ["$$rw.status", 'PENDING'] }
                                    }
                                },
                                as: "p",
                                in: "$$p.amount"
                            }
                        }
                    }
                }
            },
            { $sort: { createdAt: -1 } }
        ]);

        res.status(200).json({ success: true, data: partners });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPartnerAnalytics = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const partner = await AffiliatePartner.findById(id);
        if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

        const [referrals, rewards, ledgerEntries] = await Promise.all([
            ReferralRecord.find({ referrerId: id }).populate('referredId', 'firstName lastName email profilePhoto role createdAt'),
            ReferralReward.find({ referrerId: id }),
            Ledger.find({ toUserId: id, type: TransactionType.REFERRAL_REWARD }).sort({ createdAt: -1 })
        ]);

        // Geographic mapping (Province-based)
        const geoStats = await mongoose.model('User').aggregate([
            { $match: { _id: { $in: referrals.map(r => r.referredId) } } },
            { $group: { _id: "$province", count: { $sum: 1 } } }
        ]);

        // Monthly Trend
        const monthlyTrend = await ReferralReward.aggregate([
            { $match: { referrerId: new mongoose.Types.ObjectId(id), status: 'REWARDED' } },
            {
                $group: {
                    _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } },
                    amount: { $sum: "$amount" }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        res.status(200).json({
            success: true,
            data: {
                partner,
                metrics: {
                    totalReferrals: referrals.length,
                    customerSignups: referrals.filter((r: any) => r.referredId?.role === 'CUSTOMER').length,
                    providerSignups: referrals.filter((r: any) => r.referredId?.role === 'PROVIDER').length,
                    conversionRate: referrals.length > 0 ? (referrals.filter(r => r.jobsCompletedCount > 0).length / referrals.length) * 100 : 0,
                    earnings: {
                        total: rewards.reduce((acc, r) => acc + r.amount, 0),
                        paid: partner.balance.paid,
                        available: partner.balance.available,
                        pending: rewards.filter(r => r.status === 'PENDING').reduce((acc, r) => acc + r.amount, 0)
                    }
                },
                geoStats,
                monthlyTrend,
                recentReferrals: referrals.slice(0, 10),
                recentTransactions: ledgerEntries.slice(0, 10)
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
