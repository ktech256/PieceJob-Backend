import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Job, { JobStatus } from '../../models/Job';
import Ledger, { TransactionType } from '../../models/Ledger';
import Provider from '../../models/Provider';

export const getProviderAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const provider = await Provider.findOne({ userId });

        if (!provider) {
            return res.status(404).json({ success: false, message: 'Provider not found' });
        }

        const stats = await Job.aggregate([
            { $match: { providerId: userId, status: JobStatus.COMPLETED } },
            { $group: {
                _id: null,
                totalJobs: { $sum: 1 },
                avgRating: { $avg: "$rating" } // Assuming rating is stored on job in full implementation
            }}
        ]);

        const earnings = await Ledger.aggregate([
            { $match: { toUserId: userId, status: 'COMPLETED', type: TransactionType.SERVICE_FEE } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalJobsCompleted: stats[0]?.totalJobs || 0,
                acceptanceRate: provider.performance?.acceptanceRate || 0,
                completionRate: provider.performance?.completionRate || 0,
                tierProgression: 45, // Simulation for now
                dailyEarnings: [], // Would aggregate by day
                weeklyEarnings: [],
                monthlyEarnings: [],
                ratingTrend: []
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch provider analytics', error });
    }
};

export const getCustomerAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        const stats = await Job.aggregate([
            { $match: { customerId: userId, status: JobStatus.COMPLETED } },
            { $group: {
                _id: null,
                totalBookings: { $sum: 1 }
            }}
        ]);

        const spending = await Ledger.aggregate([
            { $match: { fromUserId: userId, status: 'COMPLETED', type: TransactionType.SERVICE_FEE } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const topCategories = await Job.aggregate([
            { $match: { customerId: userId, status: JobStatus.COMPLETED } },
            { $group: { _id: "$serviceCode", count: { $sum: 1 }, amount: { $sum: "$serviceFee" } } },
            { $sort: { amount: -1 } },
            { $limit: 5 },
            { $project: { categoryName: "$_id", count: 1, amount: 1, _id: 0 } }
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalBookings: stats[0]?.totalBookings || 0,
                totalSpending: spending[0]?.total || 0,
                topCategories,
                spendingHistory: []
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch customer analytics', error });
    }
};
