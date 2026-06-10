import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User, { UserRole } from '../../models/User';
import Provider from '../../models/Provider';
import Job, { JobStatus } from '../../models/Job';
import Ledger, { TransactionType } from '../../models/Ledger';

export const getOperationalAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.query.countryCode as string || req.user?.countryCode;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Revenue Aggregations
    const revenueStats = await Ledger.aggregate([
      { $match: { ...query, status: 'COMPLETED', type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] } } },
      { $facet: {
        total: [{ $group: { _id: null, sum: { $sum: "$amount" } } }],
        today: [{ $match: { createdAt: { $gte: startOfToday } } }, { $group: { _id: null, sum: { $sum: "$amount" } } }],
        week: [{ $match: { createdAt: { $gte: startOfWeek } } }, { $group: { _id: null, sum: { $sum: "$amount" } } }],
        month: [{ $match: { createdAt: { $gte: startOfMonth } } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]
      }}
    ]);

    // Job Aggregations
    const jobStats = await Job.aggregate([
        { $match: query },
        { $facet: {
            counts: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
            today: [{ $match: { createdAt: { $gte: startOfToday } } }, { $count: "count" }],
            week: [{ $match: { createdAt: { $gte: startOfWeek } } }, { $count: "count" }],
            month: [{ $match: { createdAt: { $gte: startOfMonth } } }, { $count: "count" }]
        }}
    ]);

    const jobsByStatus: Record<string, number> = {};
    jobStats[0].counts.forEach((c: any) => { jobsByStatus[c._id] = c.count; });

    const analytics = {
        currency: "USD", // Should be fetched from country settings
        business: {
            revenue: {
                totalRevenue: revenueStats[0].total[0]?.sum || 0,
                revenueToday: revenueStats[0].today[0]?.sum || 0,
                revenueWeek: revenueStats[0].week[0]?.sum || 0,
                revenueMonth: revenueStats[0].month[0]?.sum || 0,
                insuranceRevenue: 0, // Placeholder for future insurance module integration
                cashRevenue: revenueStats[0].total[0]?.sum || 0
            },
            payments: {
                paymentsPaid: await Ledger.countDocuments({ ...query, status: 'COMPLETED' }),
                paymentsPending: await Ledger.countDocuments({ ...query, status: 'PENDING' }),
                paymentsRefunded: await Ledger.countDocuments({ ...query, type: TransactionType.REFUND })
            },
            jobs: {
                totalJobs: await Job.countDocuments(query),
                jobsToday: jobStats[0].today[0]?.count || 0,
                jobsWeek: jobStats[0].week[0]?.count || 0,
                jobsMonth: jobStats[0].month[0]?.count || 0,
                jobsCompleted: jobsByStatus[JobStatus.COMPLETED] || 0,
                jobsCancelled: jobsByStatus[JobStatus.CANCELLED] || 0
            }
        },
        operations: {
            users: {
                totalCustomers: await User.countDocuments({ ...query, role: UserRole.CUSTOMER }),
                totalProviders: await User.countDocuments({ ...query, role: UserRole.PROVIDER })
            },
            providers: {
                onlineProviders: await Provider.countDocuments({ ...query, isOnline: true }),
                suspendedProviders: await Provider.countDocuments({ ...query, suspendedUntil: { $gt: new Date() } }),
                pendingVerificationProviders: await Provider.countDocuments({ ...query, verificationStatus: 'PENDING' })
            },
            jobsByStatus,
            avgCompletionMinutes: 0 // Logic to calculate avg time between STARTED and COMPLETED
        }
    };

    res.status(200).json({ success: true, stats: analytics });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics', error });
  }
};
