import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User, { UserRole } from '../../models/User';
import Provider from '../../models/Provider';
import Job, { JobStatus } from '../../models/Job';
import Ledger, { TransactionType } from '../../models/Ledger';
import ExchangeRate from '../../models/ExchangeRate';
import Country from '../../models/Country';
import SystemSettings from '../../models/SystemSettings';
import PanicAlert from '../../models/PanicAlert';
import Dispute from '../../models/Dispute';
import * as analyticsService from '../../services/analytics.service';
import mongoose from 'mongoose';

export const getOperationalAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ success: false, message: 'Database connection not established. Neural Link offline.' });
    }

    const countryCode = req.query.countryCode as string || req.user?.countryCode;
    const isGlobal = countryCode === 'GLOBAL';
    const query: any = {};
    if (!isGlobal) {
      query.countryCode = countryCode;
    }

    let targetCurrency = 'USD';
    let currencySymbol = '$';

    if (!isGlobal) {
        const [country, settings] = await Promise.all([
            Country.findOne({ code: countryCode }),
            SystemSettings.findOne({ countryCode })
        ]);
        targetCurrency = settings?.currencyCode || country?.currency || 'USD';
        currencySymbol = settings?.currencySymbol || '$';
    }

    const [growth, efficiency, financials, revenueTrends] = await Promise.all([
        analyticsService.getGrowthAnalytics(countryCode),
        analyticsService.getEfficiencyMetrics(countryCode),
        analyticsService.getFinancialBreakdown(countryCode, targetCurrency),
        analyticsService.getRevenueTrends(countryCode, targetCurrency)
    ]);

    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Job Aggregations
    const jobStats = await Job.aggregate([
        { $match: query },
        { $facet: {
            counts: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
            today: [{ $match: { createdAt: { $gte: startOfToday } } }, { $count: "count" }]
        }}
    ]);

    const jobsByStatus: Record<string, number> = {};
    jobStats[0].counts.forEach((c: any) => { jobsByStatus[c._id] = c.count; });

    const revenueToday = revenueTrends.find(t => t.date === todayStr)?.amount || 0;

    const analytics = {
        currency: targetCurrency,
        currencySymbol: currencySymbol,
        growth,
        efficiency,
        financials,
        revenueTrends,
        business: {
            revenue: {
                totalRevenue: financials.grossRevenue,
                revenueToday
            },
            jobs: {
                totalJobs: await Job.countDocuments(query),
                activeJobs: await Job.countDocuments({
                    ...query,
                    status: { $in: [JobStatus.BROADCASTED, JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED] }
                }),
                jobsToday: jobStats[0].today[0]?.count || 0,
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
                onlineProviders: await Provider.countDocuments({
                    ...query,
                    isOnline: true,
                    suspendedUntil: { $lte: new Date() } // Not suspended
                }),
                suspendedProviders: await Provider.countDocuments({ ...query, suspendedUntil: { $gt: new Date() } }),
                pendingVerificationProviders: await Provider.countDocuments({ ...query, verificationStatus: 'PENDING' })
            },
            jobsByStatus,
            sosCount: await PanicAlert.countDocuments(query),
            disputeCount: await Dispute.countDocuments(query)
        }
    };

    res.status(200).json({ success: true, stats: analytics });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics', error });
  }
};

export const getLiveOpsData = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const [providers, activeJobs] = await Promise.all([
            // Fetch ALL providers for the country to show both online (green) and offline (red)
            Provider.find(query).populate('userId', 'firstName lastName role'),
            Job.find({ ...query, status: { $in: [JobStatus.BROADCASTED, JobStatus.ACCEPTED, JobStatus.ARRIVED, JobStatus.STARTED, JobStatus.EN_ROUTE] } })
        ]);

        res.status(200).json({
            success: true,
            data: {
                providers,
                activeJobs
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Live Ops Fetch Failed', error });
    }
};

export const getGlobalBreakdown = async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== UserRole.SUPER_ADMIN) {
            return res.status(403).json({ success: false, message: 'Access restricted to Super Admin' });
        }

        const rates = await ExchangeRate.find();
        const getRate = (from: string) => rates.find(r => r.fromCurrency === from && r.toCurrency === 'USD')?.rate || 1;

        // Revenue by Country
        const revenueByCountry = await Ledger.aggregate([
            { $match: { status: 'COMPLETED', type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] } } },
            { $group: { _id: "$countryCode", total: { $sum: "$amount" }, currency: { $first: "$currency" } } }
        ]);

        const convertedByCountry = revenueByCountry.map(c => ({
            countryCode: c._id,
            totalUsd: c.total * getRate(c.currency)
        }));

        // Revenue by Category (requires joining with Jobs)
        const revenueByCategory = await Ledger.aggregate([
            { $match: { status: 'COMPLETED', type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] } } },
            { $lookup: { from: 'jobs', localField: 'jobId', foreignField: '_id', as: 'job' } },
            { $unwind: "$job" },
            { $group: { _id: "$job.serviceCode", total: { $sum: "$amount" }, currency: { $first: "$currency" } } }
        ]);

        const convertedByCategory = revenueByCategory.map(cat => ({
            category: cat._id,
            totalUsd: cat.total * getRate(cat.currency)
        }));

        res.status(200).json({
            success: true,
            breakdown: {
                byCountry: convertedByCountry,
                byCategory: convertedByCategory
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Breakdown failed', error });
    }
};

export const getHeatmapData = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        // Group jobs by coordinates (roughly rounding to 3 decimal places for clustering)
        const density = await Job.aggregate([
            { $match: query },
            { $group: {
                _id: {
                    lat: { $round: [{ $arrayElemAt: ["$location.coordinates", 1] }, 3] },
                    lng: { $round: [{ $arrayElemAt: ["$location.coordinates", 0] }, 3] }
                },
                weight: { $sum: 1 }
            }},
            { $project: {
                lat: "$_id.lat",
                lng: "$_id.lng",
                weight: 1,
                _id: 0
            }}
        ]);

        // Calculate real growth trend (last 7 days vs previous 7 days)
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

        const currentWeekCount = await Job.countDocuments({ ...query, createdAt: { $gte: sevenDaysAgo } });
        const previousWeekCount = await Job.countDocuments({ ...query, createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } });

        const growthTrend = previousWeekCount === 0
            ? (currentWeekCount > 0 ? 100 : 0)
            : ((currentWeekCount - previousWeekCount) / previousWeekCount) * 100;

        res.status(200).json({
            success: true,
            density,
            stats: {
                totalPoints: density.length,
                growthTrend,
                surgeRecommendation: density.length > 10 ? 1.2 : 1.0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Heatmap data failed', error });
    }
};
