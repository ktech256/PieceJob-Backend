import Job, { JobStatus } from '../models/Job';
import User, { UserRole } from '../models/User';
import Ledger, { TransactionType } from '../models/Ledger';
import * as notificationQueue from './notification.queue';
import { logger } from '../utils/logger';

export const sendDailyPlatformSummary = async (countryCode: string = 'GLOBAL') => {
    try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const query = countryCode === 'GLOBAL' ? {} : { countryCode };

        // 1. Stats
        const newUsers = await User.countDocuments({ ...query, createdAt: { $gte: startOfToday } });
        const newJobs = await Job.countDocuments({ ...query, createdAt: { $gte: startOfToday } });
        const completedJobs = await Job.countDocuments({ ...query, status: JobStatus.COMPLETED, updatedAt: { $gte: startOfToday } });

        const revenueLogs = await Ledger.find({
            ...query,
            type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] },
            status: 'COMPLETED',
            createdAt: { $gte: startOfToday }
        });
        const totalRevenue = revenueLogs.reduce((acc, curr) => acc + curr.amount, 0);

        // 2. Fetch Admin Emails
        const admins = await User.find({ role: UserRole.SUPER_ADMIN });
        const adminEmails = admins.map(a => a.email);

        if (adminEmails.length === 0) return;

        // 3. Dispatch
        for (const email of adminEmails) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email,
                templateCode: 'ADMIN_DAILY_SUMMARY',
                templateData: {
                    date: startOfToday.toDateString(),
                    newUsers: newUsers.toString(),
                    newJobs: newJobs.toString(),
                    completedJobs: completedJobs.toString(),
                    totalRevenue: totalRevenue.toFixed(2),
                    countryCode
                },
                countryCode
            });
        }

        logger.info(`ADMIN_REPORT | Daily summary dispatched for ${countryCode}`);
    } catch (error: any) {
        logger.error(`ADMIN_REPORT | FAILED | Error: ${error.message}`);
    }
};

export const sendWeeklyWorkspaceSummary = async (countryCode: string) => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const query = countryCode === 'GLOBAL' ? {} : { countryCode };

        // 1. Stats
        const totalUsers = await User.countDocuments({ ...query, createdAt: { $gte: sevenDaysAgo } });
        const totalJobs = await Job.countDocuments({ ...query, createdAt: { $gte: sevenDaysAgo } });
        const revenueLogs = await Ledger.find({
            ...query,
            type: { $in: [TransactionType.SERVICE_FEE, TransactionType.BOOKING_FEE] },
            status: 'COMPLETED',
            createdAt: { $gte: sevenDaysAgo }
        });
        const totalRevenue = revenueLogs.reduce((acc, curr) => acc + curr.amount, 0);

        // 2. Fetch Workspace Admins
        const admins = await User.find({ role: { $in: [UserRole.COUNTRY_ADMIN, UserRole.SUPER_ADMIN] }, countryCode });
        const adminEmails = admins.map(a => a.email);

        if (adminEmails.length === 0) return;

        // 3. Dispatch
        for (const email of adminEmails) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email,
                templateCode: 'ADMIN_WEEKLY_SUMMARY',
                templateData: {
                    period: `${sevenDaysAgo.toDateString()} - ${new Date().toDateString()}`,
                    totalUsers: totalUsers.toString(),
                    totalJobs: totalJobs.toString(),
                    totalRevenue: totalRevenue.toFixed(2),
                    countryCode
                },
                countryCode
            });
        }
    } catch (error: any) {
        logger.error(`ADMIN_REPORT | WEEKLY_FAILED | Error: ${error.message}`);
    }
};
