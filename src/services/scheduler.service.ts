import * as performanceService from './provider-performance.service';
import * as financialService from './financial.service';
import * as corporateSchedulingService from './corporate-scheduling.service';

export const initSchedulers = () => {
    // 1. Performance Recalculation (Every 24 hours)
    setInterval(async () => {
        console.log('Running provider performance evaluation...');
        await performanceService.takePerformanceSnapshot('GLOBAL');
    }, 24 * 60 * 60 * 1000);

    // 2. Escrow Release (Every 1 hour)
    setInterval(async () => {
        console.log('Running escrow release check...');
        await financialService.releaseEscrowFunds();
    }, 60 * 60 * 1000);

    // 3. Corporate Job Generation (Every 15 minutes)
    setInterval(async () => {
        console.log('Processing corporate schedules...');
        await corporateSchedulingService.processSchedules();
    }, 15 * 60 * 1000);

    // 4. Ecosystem Health Monitor (Every 5 minutes)
    setInterval(async () => {
        const { runFullEcosystemCheck } = require('./health-monitor.service');
        await runFullEcosystemCheck();
    }, 5 * 60 * 1000);

    console.log('System Schedulers Initialized');
};
