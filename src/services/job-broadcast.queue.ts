import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as jobService from './job.service';
import { logger } from '../utils/logger';
// ...
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
