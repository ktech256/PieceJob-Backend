import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as jobService from './job.service';
import { logger } from '../utils/logger';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_URL = process.env.REDIS_URL;

const connection = REDIS_URL ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) : new IORedis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null,
});

export const broadcastQueue = new Queue('job-broadcasts', { connection: connection as any });

export const addJobToBroadcastQueue = async (jobId: string, wave: number = 1) => {
    // PAGE 7: Waves are Wave 1 (0s), Wave 2 (10s), Wave 3 (25s), Wave 4 (45s)
    // Delay mapping based on Specification Section 8
    const delays = [0, 0, 10000, 15000, 20000]; // cumulative: 0, 10, 25, 45
    const delay = delays[wave] || 0;

    await broadcastQueue.add('broadcast-wave', { jobId, wave }, {
        jobId: `job-${jobId}-wave-${wave}`, // Prevent duplicate wave scheduling
        delay
    });
};

const worker = new Worker('job-broadcasts', async (job: Job) => {
    const { jobId, wave } = job.data;
    logger.debug(`Processing Broadcast Wave ${wave} for Job ${jobId}`);

    const nextWave = await jobService.executeBroadcastWave(jobId, wave);

    if (nextWave) {
        await addJobToBroadcastQueue(jobId, nextWave);
    }
}, { connection: connection as any });

worker.on('failed', (job, err) => {
    logger.error(`Broadcast Wave failed for job ${job?.id}:`, err);
});
