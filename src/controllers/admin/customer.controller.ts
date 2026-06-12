import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User, { UserRole } from '../../models/User';
import Job from '../../models/Job';
import Wallet from '../../models/Wallet';
import Ledger from '../../models/Ledger';
import LoginLog from '../../models/LoginLog';
import Dispute from '../../models/Dispute';
import PanicAlert from '../../models/PanicAlert';
import mongoose from 'mongoose';

export const listCustomers = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        const { isTestUser } = req.query;
        const query: any = { role: UserRole.CUSTOMER };

        if (countryCode && countryCode !== 'GLOBAL') {
            query.countryCode = countryCode;
        }

        if (isTestUser !== undefined) {
            query.isTestUser = isTestUser === 'true';
        }

        const users = await User.find(query).select('-passwordHash').sort({ createdAt: -1 });

        // Enhance with metrics
        const customersWithMetrics = await Promise.all(users.map(async (user) => {
            const jobsAgg = await Job.aggregate([
                { $match: { customerId: user._id } },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ]);

            const spendAgg = await Ledger.aggregate([
                { $match: { fromUserId: user._id, status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]);

            const wallet = await Wallet.findOne({ userId: user._id });

            return {
                ...user.toObject(),
                metrics: {
                    totalJobs: jobsAgg.reduce((acc, curr) => acc + curr.count, 0),
                    completedJobs: jobsAgg.find(j => j._id === 'COMPLETED')?.count || 0,
                    cancelledJobs: jobsAgg.find(j => j._id === 'CANCELLED')?.count || 0,
                    lifetimeSpend: spendAgg[0]?.total || 0,
                    walletBalance: (wallet?.balanceMain || 0) + (wallet?.balanceCredit || 0)
                }
            };
        }));

        res.status(200).json({ success: true, customers: customersWithMetrics });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch customers', error });
    }
};

export const getCustomerDetail = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id).select('-passwordHash');
        if (!user) return res.status(404).json({ success: false, message: 'Customer not found' });

        const jobs = await Job.find({ customerId: id }).sort({ createdAt: -1 }).limit(50);
        const wallet = await Wallet.findOne({ userId: id });
        const financialLogs = await Ledger.find({
            $or: [{ fromUserId: id }, { toUserId: id }]
        }).sort({ createdAt: -1 }).limit(100);

        const logins = await LoginLog.find({ userId: id }).sort({ timestamp: -1 }).limit(10);
        const disputes = await Dispute.find({ raisedBy: id }).sort({ createdAt: -1 });
        const sosEvents = await PanicAlert.find({ userId: id }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            customer: user,
            activity: {
                jobs,
                wallet,
                financialLogs,
                logins,
                disputes,
                sosEvents
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch customer details', error });
    }
};
