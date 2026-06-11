import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { sendPushNotification } from './notification.service';
import { sendSms } from './sms.service';
import * as templateService from './notification-template.service';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_URL = process.env.REDIS_URL;

const connection = REDIS_URL ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) : new IORedis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
      // If we are on Render and no Redis is provided, don't keep retrying forever
      if (times > 3 && !process.env.REDIS_HOST) {
          console.warn('⚠️ Redis not found at localhost:6379. Queues will be disabled.');
          return null;
      }
      return Math.min(times * 50, 2000);
  }
});

connection.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
        // Suppress noisy logs if it's just a missing local redis
    } else {
        console.error('Redis Connection Error:', err);
    }
});

export const notificationQueue = new Queue('notifications', { connection });

export interface NotificationJobData {
    type: 'PUSH' | 'SMS' | 'EMAIL';
    userId?: string;
    fcmToken?: string;
    phoneNumber?: string;
    email?: string;
    templateCode?: string;
    templateData?: Record<string, string>;
    title?: string;
    body?: string;
    data?: any;
    countryCode?: string;
}

export const addNotificationToQueue = async (data: NotificationJobData, eventId?: string) => {
    try {
        await notificationQueue.add('send-notification', data, {
            jobId: eventId, // BullMQ deduplication
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        });
    } catch (e) {
        console.error('Failed to add to notification queue (Redis might be down):', e);
        // Fallback or just ignore for now to prevent crash
    }
};

const worker = new Worker('notifications', async (job: Job<NotificationJobData>) => {
    let { type, userId, fcmToken, phoneNumber, email, templateCode, templateData, title, body, data, countryCode } = job.data;

    try {
        // Resolve template if code is provided
        if (templateCode) {
            const template = await templateService.getTemplate(templateCode, type, countryCode || 'GLOBAL');
            if (template) {
                const resolved = templateService.resolveTemplate(template, templateData || {});
                title = resolved.title;
                body = resolved.body;
            } else {
                console.warn(`Template ${templateCode} not found for channel ${type}`);
            }
        }

        if (!body) throw new Error('Notification body is missing after template resolution');

        if (type === 'PUSH' && fcmToken) {
            await sendPushNotification(userId!, fcmToken, title || 'PieceJob', body, data);
        } else if (type === 'SMS' && phoneNumber) {
            await sendSms(phoneNumber, body);
        } else if (type === 'EMAIL' && email) {
            // await sendEmail(email, title || 'PieceJob', body);
            console.log(`[EMAIL_SIMULATION] to ${email}: ${title} - ${body}`);
        }
    } catch (error) {
        console.error(`Error in notification worker for job ${job.id}:`, error);
        throw error; // Let BullMQ handle retries
    }
}, { connection });

worker.on('completed', job => {
  console.log(`Notification job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Notification job ${job?.id} failed with error: ${err.message}`);
});
