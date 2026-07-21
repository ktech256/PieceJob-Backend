import { Request, Response } from 'express';
import AffiliatePartner, { AffiliateStatus } from '../models/AffiliatePartner';
import AffiliateSettlement, { SettlementStatus } from '../models/AffiliateSettlement';
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

        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Fetch reward history for trend and stats
        const rewards = await ReferralReward.find({ referrerId: partnerId }).populate('referredId', 'firstName lastName');
        const referrals = await ReferralRecord.find({ referrerId: partnerId }).populate('referredId', 'firstName lastName role isVerified createdAt');

        const earningsToday = rewards.filter(r => r.createdAt >= startOfDay).reduce((acc, r) => acc + r.amount, 0);
        const earningsWeekly = rewards.filter(r => r.createdAt >= startOfWeek).reduce((acc, r) => acc + r.amount, 0);
        const earningsMonthly = rewards.filter(r => r.createdAt >= startOfMonth).reduce((acc, r) => acc + r.amount, 0);

        const latestCommission = rewards.length > 0 ? rewards.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] : null;
        const topReferral = referrals.length > 0 ? referrals.sort((a, b) => (b.totalCommissionGenerated || 0) - (a.totalCommissionGenerated || 0))[0] : null;
        const latestReferral = referrals.length > 0 ? referrals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] : null;

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    ...partner.stats,
                    completedJobs: referrals.reduce((acc, r) => acc + (r.jobsCompletedCount || 0), 0),
                    conversionRate: referrals.length > 0 ? (referrals.filter(r => (r.jobsCompletedCount || 0) > 0).length / referrals.length) * 100 : 0,
                    // ISSUE 5 counters
                    lifetimeJobValue: referrals.reduce((acc, r) => acc + (r.lifetimeJobValue || 0), 0),
                    averageCommissionPerReferral: referrals.length > 0 ? (rewards.reduce((acc, r) => acc + r.amount, 0) / referrals.length) : 0,
                    customerSignups: referrals.filter((r: any) => r.referredId?.role === 'CUSTOMER').length,
                    providerSignups: referrals.filter((r: any) => r.referredId?.role === 'PROVIDER').length,
                    businessSignups: referrals.filter((r: any) => r.referredId?.role === 'BUSINESS' || r.referredId?.role === 'CORPORATE_EMPLOYEE').length,
                    verifiedRegistrations: referrals.filter((r: any) => r.referredId?.isVerified).length,
                    registrations: referrals.length
                },
                balance: partner.balance,
                bankingDetails: partner.bankingDetails,
                earnings: {
                    today: earningsToday,
                    weekly: earningsWeekly,
                    monthly: earningsMonthly,
                    lifetime: partner.balance.lifetime
                },
                highlights: {
                    latestCommission: latestCommission ? {
                        amount: latestCommission.amount,
                        date: latestCommission.createdAt,
                        referredUser: latestCommission.referredId
                    } : null,
                    topReferral: topReferral ? {
                        id: topReferral._id,
                        commission: topReferral.totalCommissionGenerated,
                        jobs: topReferral.jobsCompletedCount
                    } : null,
                    latestReferral: latestReferral ? {
                        name: `${(latestReferral.referredId as any).firstName} ${(latestReferral.referredId as any).lastName}`,
                        date: latestReferral.createdAt
                    } : null
                },
                recentActivity: rewards.slice(0, 10).map(r => ({
                    id: r._id,
                    amount: r.amount,
                    status: r.status,
                    timestamp: r.createdAt,
                    referredUserId: r.referredId
                })),
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
        const records = await ReferralRecord.find({ referrerId: partnerId }).populate('referredId', 'firstName lastName role createdAt');
        const rewards = await ReferralReward.find({ referrerId: partnerId });

        res.status(200).json({
            success: true,
            data: {
                totalReferrals: records.length,
                qualifiedCount: records.filter(r => r.jobsCompletedCount > 0).length,
                referrals: records.map(r => ({
                    id: r._id,
                    user: {
                        name: `${(r.referredId as any).firstName} ${(r.referredId as any).lastName}`,
                        role: (r.referredId as any).role,
                        joinedAt: (r.referredId as any).createdAt
                    },
                    jobsCompleted: r.jobsCompletedCount,
                    rewardsIssued: r.rewardsIssuedCount,
                    commissionGenerated: r.totalCommissionGenerated,
                    lifetimeSpend: r.totalSpend,
                    status: r.status,
                    lastActivity: r.lastCompletedJobAt
                }))
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

export const updatePartnerBanking = async (req: Request, res: Response) => {
    try {
        const partnerId = (req as any).user?.partnerId;
        const { bankName, accountHolder, accountNumber, branchCode, accountType, swiftCode } = req.body;

        const partner = await AffiliatePartner.findByIdAndUpdate(partnerId, {
            bankingDetails: {
                bankName, accountHolder, accountNumber, branchCode, accountType, swiftCode
            }
        }, { new: true });

        res.status(200).json({ success: true, data: partner });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createPartner = async (req: Request, res: Response) => {
    logger.info(`[AFFILIATE] Onboarding Request Received: ${req.body.email}`);
    try {
        const { name, email, phone, type, contactPerson, countryCode, commissionModel, commissionValue, password, commissionSettings } = req.body;

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
            referralCode,
            commissionSettings: {
                ...(commissionSettings || {
                    customerReward: 10,
                    providerReward: 20,
                    businessReward: 50,
                    maxRewardableJobs: 5,
                    customerEnabled: true,
                    providerEnabled: true,
                    businessEnabled: true,
                    effectiveDate: new Date()
                }),
                createdBy: (req as any).user?.userId
            }
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

        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Enterprise Analytics Aggregation (ISSUE 6)
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
                    customerReferrals: { $size: { $filter: { input: "$referralDocs", as: "r", cond: { $eq: ["$$r.referrerType", "PARTNER"] } } } },
                    jobsLifetime: { $sum: "$referralDocs.jobsCompletedCount" },
                    jobsToday: {
                        $size: {
                            $filter: {
                                input: "$rewardDocs",
                                as: "rw",
                                cond: { $gte: ["$$rw.createdAt", startOfDay] }
                            }
                        }
                    },
                    jobsWeekly: {
                        $size: {
                            $filter: {
                                input: "$rewardDocs",
                                as: "rw",
                                cond: { $gte: ["$$rw.createdAt", startOfWeek] }
                            }
                        }
                    },
                    jobsMonthly: {
                        $size: {
                            $filter: {
                                input: "$rewardDocs",
                                as: "rw",
                                cond: { $gte: ["$$rw.createdAt", startOfMonth] }
                            }
                        }
                    },
                    earningsLifetime: { $sum: "$rewardDocs.amount" },
                    averageEarningsPerReferral: {
                        $cond: [
                            { $gt: [{ $size: "$referralDocs" }, 0] },
                            { $divide: [{ $sum: "$rewardDocs.amount" }, { $size: "$referralDocs" }] },
                            0
                        ]
                    },
                    paidCommission: "$balance.paid",
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
                    },
                    revenueGenerated: { $sum: "$referralDocs.lifetimeJobValue" },
                    platformRevenue: { $sum: "$referralDocs.lifetimePlatformRevenue" },
                    conversionRate: {
                        $cond: [
                            { $gt: [{ $size: "$referralDocs" }, 0] },
                            { $multiply: [{ $divide: [{ $size: { $filter: { input: "$referralDocs", as: "r", cond: { $gt: ["$$r.jobsCompletedCount", 0] } } } }, { $size: "$referralDocs" }] }, 100] },
                            0
                        ]
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

export const updatePartner = async (req: Request, res: Response) => {
    const { id } = req.params;
    logger.info(`[AFFILIATE] Update Request Received for Partner: ${id}`);
    try {
        const { email, phone, name, type, contactPerson, countryCode, commissionModel, commissionValue, status } = req.body;

        const partner = await AffiliatePartner.findById(id);
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        // 1. Duplicate Check for Email/Phone (excluding current partner)
        if (email || phone) {
            const duplicate = await AffiliatePartner.findOne({
                _id: { $ne: id },
                $or: [
                    ...(email ? [{ email: email.toLowerCase() }] : []),
                    ...(phone ? [{ phone }] : [])
                ]
            });

            if (duplicate) {
                const field = duplicate.email === email?.toLowerCase() ? 'Email' : 'Phone';
                return res.status(409).json({
                    success: false,
                    message: `Another partner is already using this ${field.toLowerCase()}.`
                });
            }
        }

        // 2. Update fields
        const updateData: any = { ...req.body };
        if (email) updateData.email = email.toLowerCase();

        if (updateData.commissionSettings) {
            updateData.commissionSettings.updatedBy = (req as any).user?.userId;
            updateData.commissionSettings.effectiveDate = new Date();
        }

        // Remove sensitive or read-only fields from updateData
        delete updateData.passwordHash;
        delete updateData.referralCode;
        delete updateData.stats;
        delete updateData.balance;

        const updatedPartner = await AffiliatePartner.findByIdAndUpdate(id, updateData, { new: true });

        logger.info(`[AFFILIATE] Partner Entity Updated: ${id}`);
        res.status(200).json({ success: true, data: updatedPartner });
    } catch (error: any) {
        logger.error(`[AFFILIATE] Update Execution Error for Partner ${id}`, error);
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

        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        const yesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const earningsToday = rewards.filter(r => r.createdAt >= startOfDay).reduce((acc, r) => acc + r.amount, 0);
        const earningsYesterday = rewards.filter(r => r.createdAt >= yesterday && r.createdAt < startOfDay).reduce((acc, r) => acc + r.amount, 0);
        const earningsWeekly = rewards.filter(r => r.createdAt >= startOfWeek).reduce((acc, r) => acc + r.amount, 0);
        const earningsMonthly = rewards.filter(r => r.createdAt >= startOfMonth).reduce((acc, r) => acc + r.amount, 0);

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
                    amount: { $sum: "$amount" },
                    jobs: { $sum: 1 }
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
                    activeLeads: referrals.filter(r => r.status === 'ACTIVE').length,
                    customerSignups: referrals.filter((r: any) => r.referredId?.role === 'CUSTOMER').length,
                    providerSignups: referrals.filter((r: any) => r.referredId?.role === 'PROVIDER').length,
                    conversionRate: referrals.length > 0 ? (referrals.filter(r => r.jobsCompletedCount > 0).length / referrals.length) * 100 : 0,
                    jobsLifetime: referrals.reduce((acc, r) => acc + r.jobsCompletedCount, 0),
                    revenueGenerated: referrals.reduce((acc, r) => acc + (r.lifetimeJobValue || 0), 0),
                    earnings: {
                        today: earningsToday,
                        yesterday: earningsYesterday,
                        weekly: earningsWeekly,
                        monthly: earningsMonthly,
                        total: partner.balance.lifetime,
                        paid: partner.balance.paid,
                        available: partner.balance.available,
                        requested: partner.balance.requested,
                        processing: partner.balance.processing,
                        pending: partner.balance.pending
                    }
                },
                geoStats,
                monthlyTrend,
                referrals: referrals.map(r => ({
                    id: r._id,
                    user: r.referredId,
                    completedJobs: r.jobsCompletedCount,
                    rewardedJobs: r.rewardsIssuedCount,
                    maxRewards: r.maxRewardableJobs,
                    commission: r.totalCommissionGenerated,
                    revenue: r.lifetimeJobValue,
                    status: r.status,
                    createdAt: r.createdAt,
                    lastJob: r.lastCompletedJobAt
                })),
                recentTransactions: ledgerEntries.slice(0, 15)
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Partner: Request a new settlement
 */
export const requestSettlement = async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const partnerId = (req as any).user?.partnerId;
        const { amount, notes } = req.body;

        const partner = await AffiliatePartner.findById(partnerId).session(session);
        if (!partner) throw new Error('Partner not found');

        if (partner.status !== AffiliateStatus.ACTIVE) {
            throw new Error('Account is not active. Settlement requests are disabled.');
        }

        const requestedAmount = Number(amount);
        if (isNaN(requestedAmount) || requestedAmount <= 0) {
            throw new Error('Invalid settlement amount.');
        }

        if (requestedAmount > partner.balance.available) {
            throw new Error('Requested amount exceeds available balance.');
        }

        // Check for existing pending settlement
        const pending = await AffiliateSettlement.findOne({
            partnerId,
            status: { $in: [SettlementStatus.PENDING, SettlementStatus.APPROVED, SettlementStatus.PROCESSING] }
        }).session(session);

        if (pending) {
            throw new Error('You already have a settlement request in progress.');
        }

        if (!partner.bankingDetails || !partner.bankingDetails.accountNumber) {
            throw new Error('Please update your banking details before requesting settlement.');
        }

        const settlementId = `SET-${uuidv4().slice(0, 8).toUpperCase()}`;

        const settlement = new AffiliateSettlement({
            settlementId,
            partnerId: partner._id,
            amount: requestedAmount,
            currency: 'R', // TODO: Dynamic based on workspace
            countryCode: partner.countryCode,
            bankDetails: partner.bankingDetails,
            partnerNotes: notes,
            auditLog: [{
                action: 'REQUEST_SUBMITTED',
                timestamp: new Date(),
                newStatus: SettlementStatus.PENDING,
                note: 'Partner submitted settlement request'
            }]
        });

        // Update Partner Balance: Available -> Requested
        partner.balance.available -= requestedAmount;
        partner.balance.requested += requestedAmount;

        await settlement.save({ session });
        await partner.save({ session });

        await session.commitTransaction();

        // Notify Admin
        notificationQueue.addNotificationToQueue({
            type: 'EMAIL',
            email: 'finance@piecejob.co', // TODO: Target correct finance team
            templateCode: 'NEW_SETTLEMENT_REQUEST',
            templateData: {
                partnerName: partner.name,
                amount: `${requestedAmount} R`,
                settlementId
            },
            countryCode: partner.countryCode
        });

        res.status(201).json({ success: true, data: settlement });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(400).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * Partner: Get own settlement history
 */
export const getPartnerSettlements = async (req: Request, res: Response) => {
    try {
        const partnerId = (req as any).user?.partnerId;
        const settlements = await AffiliateSettlement.find({ partnerId }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: settlements });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Admin: Get all settlement requests
 */
export const adminGetSettlements = async (req: Request, res: Response) => {
    try {
        const { countryCode, status, partnerId } = req.query;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (status) query.status = status;
        if (partnerId) query.partnerId = partnerId;

        const settlements = await AffiliateSettlement.find(query)
            .populate('partnerId', 'name referralCode type countryCode balance stats')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: settlements });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Admin: Update settlement status (Approve, Process, Pay, Reject)
 */
export const adminUpdateSettlementStatus = async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id } = req.params;
        const { status, note, paymentReference } = req.body;
        const adminId = (req as any).user?.userId;

        const settlement = await AffiliateSettlement.findById(id).session(session);
        if (!settlement) throw new Error('Settlement request not found');

        const partner = await AffiliatePartner.findById(settlement.partnerId).session(session);
        if (!partner) throw new Error('Partner not found');

        const oldStatus = settlement.status;
        const newStatus = status as SettlementStatus;

        if (oldStatus === newStatus) return res.status(200).json({ success: true, data: settlement });

        // Logic based on status transition
        switch (newStatus) {
            case SettlementStatus.PROCESSING:
                // Move Requested -> Processing
                partner.balance.requested -= settlement.amount;
                partner.balance.processing += settlement.amount;
                settlement.processedAt = new Date();
                break;

            case SettlementStatus.PAID:
                // Finalize payment
                if (oldStatus === SettlementStatus.PROCESSING) {
                    partner.balance.processing -= settlement.amount;
                } else if (oldStatus === SettlementStatus.APPROVED || oldStatus === SettlementStatus.PENDING) {
                    partner.balance.requested -= settlement.amount;
                }
                partner.balance.paid += settlement.amount;
                settlement.paidAt = new Date();
                settlement.paymentReference = paymentReference;

                // Create Ledger Entry
                await Ledger.create([{
                    transactionId: `PAY-${uuidv4().slice(0, 8).toUpperCase()}`,
                    toUserId: partner._id,
                    amount: settlement.amount,
                    currency: settlement.currency,
                    countryCode: settlement.countryCode,
                    type: TransactionType.PAYOUT,
                    status: 'COMPLETED',
                    description: `Affiliate Settlement: ${settlement.settlementId}`,
                    metadata: { settlementId: settlement._id }
                }], { session });
                break;

            case SettlementStatus.REJECTED:
            case SettlementStatus.CANCELLED:
                // Return funds to Available
                if (oldStatus === SettlementStatus.PROCESSING) {
                    partner.balance.processing -= settlement.amount;
                } else {
                    partner.balance.requested -= settlement.amount;
                }
                partner.balance.available += settlement.amount;
                break;
        }

        settlement.status = newStatus;
        settlement.auditLog.push({
            action: `ADMIN_${newStatus}`,
            adminId,
            timestamp: new Date(),
            oldStatus,
            newStatus,
            note
        });

        await settlement.save({ session });
        await partner.save({ session });

        await session.commitTransaction();

        // Notification to Partner
        notificationQueue.addNotificationToQueue({
            type: 'NOTIFICATION',
            userId: partner._id.toString(),
            title: `Settlement Update: ${newStatus}`,
            body: `Your settlement request ${settlement.settlementId} is now ${newStatus.toLowerCase()}. ${note || ''}`,
            countryCode: partner.countryCode
        });

        res.status(200).json({ success: true, data: settlement });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(400).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};
