import User, { UserRole } from '../models/User';
import Provider from '../models/Provider';
import Job, { JobStatus } from '../models/Job';
import Ledger, { TransactionType } from '../models/Ledger';
import ExchangeRate from '../models/ExchangeRate';
import Country from '../models/Country';
import PanicAlert from '../models/PanicAlert';
import Dispute from '../models/Dispute';

export const getGrowthAnalytics = async (countryCode: string = 'GLOBAL') => {
    const isGlobal = countryCode === 'GLOBAL';
    const query: any = {};
    if (!isGlobal) query.countryCode = countryCode;

    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [currentMonthUsers, lastMonthUsers, currentMonthProviders, lastMonthProviders] = await Promise.all([
        User.countDocuments({ ...query, role: UserRole.CUSTOMER, createdAt: { $gte: startOfCurrentMonth } }),
        User.countDocuments({ ...query, role: UserRole.CUSTOMER, createdAt: { $gte: startOfLastMonth, $lt: startOfCurrentMonth } }),
        User.countDocuments({ ...query, role: UserRole.PROVIDER, createdAt: { $gte: startOfCurrentMonth } }),
        User.countDocuments({ ...query, role: UserRole.PROVIDER, createdAt: { $gte: startOfLastMonth, $lt: startOfCurrentMonth } })
    ]);

    const calculateGrowth = (current: number, last: number) => {
        if (last === 0) return current > 0 ? 100 : 0;
        return ((current - last) / last) * 100;
    };

    return {
        userGrowth: {
            current: currentMonthUsers,
            last: lastMonthUsers,
            percentage: calculateGrowth(currentMonthUsers, lastMonthUsers)
        },
        providerGrowth: {
            current: currentMonthProviders,
            last: lastMonthProviders,
            percentage: calculateGrowth(currentMonthProviders, lastMonthProviders)
        }
    };
};

export const getEfficiencyMetrics = async (countryCode: string = 'GLOBAL') => {
    const isGlobal = countryCode === 'GLOBAL';
    const query: any = {};
    if (!isGlobal) query.countryCode = countryCode;

    const pipeline = [
        { $match: { ...query, status: JobStatus.COMPLETED } },
        {
            $group: {
                _id: null,
                avgAcceptanceTime: { $avg: { $subtract: ["$acceptedAt", "$createdAt"] } },
                avgArrivalTime: { $avg: { $subtract: ["$arrivedAt", "$acceptedAt"] } },
                avgCompletionTime: { $avg: { $subtract: ["$completedAt", "$startedAt"] } }
            }
        }
    ];

    const results = await Job.aggregate(pipeline);

    // Wave Performance
    const totalBroadcasted = await Job.countDocuments({ ...query, status: { $ne: JobStatus.DRAFT } });
    const totalAccepted = await Job.countDocuments({ ...query, acceptedAt: { $exists: true } });
    const totalCompleted = await Job.countDocuments({ ...query, status: JobStatus.COMPLETED });

    // Convert ms to minutes
    const toMinutes = (ms: number) => Math.round((ms || 0) / 60000);

    return {
        avgAcceptanceMinutes: toMinutes(results[0]?.avgAcceptanceTime),
        avgArrivalMinutes: toMinutes(results[0]?.avgArrivalTime),
        avgCompletionMinutes: toMinutes(results[0]?.avgCompletionTime),
        wavePerformance: {
            broadcastSuccessRate: totalBroadcasted > 0 ? (totalAccepted / totalBroadcasted) * 100 : 0,
            completionRate: totalAccepted > 0 ? (totalCompleted / totalAccepted) * 100 : 0
        }
    };
};

export const getFinancialBreakdown = async (countryCode: string = 'GLOBAL', targetCurrency: string = 'USD') => {
    const isGlobal = countryCode === 'GLOBAL';
    const query: any = {};
    if (!isGlobal) query.countryCode = countryCode;

    const rates = await ExchangeRate.find();

    const getRate = (from: string, to: string) => {
        if (from === to) return 1;
        // Convert from -> USD then USD -> to
        const fromToUsd = rates.find(r => r.fromCurrency === from && r.toCurrency === 'USD')?.rate || 1;
        const usdToTarget = rates.find(r => r.fromCurrency === to && r.toCurrency === 'USD')?.rate || 1;
        return fromToUsd / usdToTarget;
    };

    const financials = await Ledger.aggregate([
        { $match: { ...query, status: 'COMPLETED' } },
        {
            $group: {
                _id: { type: "$type", currency: "$currency" },
                total: { $sum: "$amount" }
            }
        }
    ]);

    // Group by type and convert to target currency
    const breakdown: any = {};
    financials.forEach(f => {
        const type = f._id.type;
        const targetAmount = f.total * getRate(f._id.currency, targetCurrency);
        if (!breakdown[type]) breakdown[type] = 0;
        breakdown[type] += targetAmount;
    });

    const grossRevenue = (breakdown[TransactionType.SERVICE_FEE] || 0) + (breakdown[TransactionType.BOOKING_FEE] || 0);
    const netCommission = breakdown[TransactionType.COMMISSION] || 0;
    const payouts = breakdown[TransactionType.PAYOUT] || 0;

    // Profitability
    const totalExpenses = payouts + (breakdown[TransactionType.REFERRAL_REWARD] || 0);
    const netProfit = grossRevenue - totalExpenses;

    return {
        currency: targetCurrency,
        grossRevenue,
        netCommission,
        payouts,
        referralRewards: breakdown[TransactionType.REFERRAL_REWARD] || 0,
        netProfit,
        margin: grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0
    };
};

export const getRevenueTrends = async (countryCode: string = 'GLOBAL', targetCurrency: string = 'USD') => {
    const isGlobal = countryCode === 'GLOBAL';
    const query: any = { status: 'COMPLETED', type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] } };
    if (!isGlobal) query.countryCode = countryCode;

    const rates = await ExchangeRate.find();
    const getRate = (from: string, to: string) => {
        if (from === to) return 1;
        const fromToUsd = rates.find(r => r.fromCurrency === from && r.toCurrency === 'USD')?.rate || 1;
        const usdToTarget = rates.find(r => r.fromCurrency === to && r.toCurrency === 'USD')?.rate || 1;
        return fromToUsd / usdToTarget;
    };

    const trends = await Ledger.aggregate([
        { $match: query },
        {
            $group: {
                _id: {
                    year: { $year: "$createdAt" },
                    month: { $month: "$createdAt" },
                    day: { $dayOfMonth: "$createdAt" },
                    currency: "$currency"
                },
                total: { $sum: "$amount" }
            }
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
    ]);

    // Group by day and convert to target currency
    const dailyData: Record<string, number> = {};
    trends.forEach(t => {
        const dateStr = `${t._id.year}-${String(t._id.month).padStart(2, '0')}-${String(t._id.day).padStart(2, '0')}`;
        const targetAmount = t.total * getRate(t._id.currency, targetCurrency);
        dailyData[dateStr] = (dailyData[dateStr] || 0) + targetAmount;
    });

    // Ensure we return an array sorted by date
    return Object.entries(dailyData)
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => a.date.localeCompare(b.date));
};
