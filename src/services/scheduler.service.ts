import * as performanceService from './provider-performance.service';
import * as financialService from './financial.service';
import * as referralService from './referral.service';
import * as corporateSchedulingService from './corporate-scheduling.service';
import * as adminReportService from './admin-report.service';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

export const initSchedulers = () => {
    // 1. Performance Recalculation (Every 24 hours)
    setInterval(async () => {
        logger.debug('Running provider performance evaluation...');
        await performanceService.takePerformanceSnapshot('GLOBAL');
    }, 24 * 60 * 60 * 1000);

    // 2. Escrow Release (Every 1 hour)
    setInterval(async () => {
        logger.debug('Running escrow release check...');
        await financialService.releaseEscrowFunds();
    }, 60 * 60 * 1000);

    // 3. Corporate Job Generation (Every 15 minutes)
    setInterval(async () => {
        logger.debug('Processing corporate schedules...');
        await corporateSchedulingService.processSchedules();
    }, 15 * 60 * 1000);

    // 4. Ecosystem Health Monitor (Every 5 minutes)
    setInterval(async () => {
        const { runFullEcosystemCheck } = require('./health-monitor.service');
        await runFullEcosystemCheck();
    }, 5 * 60 * 1000);

    // 5. Referral Reward Payouts (Every 30 minutes)
    setInterval(async () => {
        logger.debug('Processing pending referral rewards...');
        await referralService.processScheduledRewards();
    }, 30 * 60 * 1000);

    // 6. Admin Daily Summary (Every 24 hours)
    setInterval(async () => {
        logger.debug('Generating daily platform summary...');
        await adminReportService.sendDailyPlatformSummary();
    }, 24 * 60 * 60 * 1000);

    // 7. Admin Weekly Summary (Every 7 days)
    setInterval(async () => {
        logger.debug('Generating weekly workspace summaries...');
        // Fetch all active countries and send reports
        const countries = await mongoose.model('Country').find({ isActive: true });
        for (const country of countries) {
            await adminReportService.sendWeeklyWorkspaceSummary(country.code);
        }
    }, 7 * 24 * 60 * 60 * 1000);

    // 8. Service Fee Reminders (Every 24 hours)
    setInterval(async () => {
        logger.debug('Running service fee reminders...');
        const countries = await mongoose.model('Country').find({ isActive: true });
        for (const country of countries) {
            await financialService.sendServiceFeeReminders(country.code);
        }
    }, 24 * 60 * 60 * 1000);

    // 9. Provider Reliability Monitoring (Every 1 minute)
    setInterval(async () => {
        const { monitorProviderReliability } = require('./job.service');
        await monitorProviderReliability();
    }, 60 * 1000);

    // 10. Performance Score Recovery (Every 24 hours)
    setInterval(async () => {
        logger.debug('Running provider score recovery...');
        await performanceService.recoverScores();
    }, 24 * 60 * 60 * 1000);

    logger.info('System Schedulers Initialized');
};
