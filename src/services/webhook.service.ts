import WebhookEvent from '../models/WebhookEvent';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export const isDuplicateWebhook = async (gateway: string, gatewayEventId: string, payload: any): Promise<boolean> => {
    if (!gatewayEventId || gatewayEventId === 'undefined') {
        logger.warn(`WEBHOOK | INVALID_ID | ${gateway} | ID: ${gatewayEventId}`);
        return false;
    }

    const eventHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    try {
        const existingEvent = await WebhookEvent.findOne({ gateway, gatewayEventId });
        if (existingEvent && existingEvent.status === 'PROCESSED') {
            logger.info(`WEBHOOK | DUPLICATE | ${gateway} | ID: ${gatewayEventId}`);
            return true;
        }

        if (!existingEvent) {
            await WebhookEvent.create({
                gateway,
                gatewayEventId,
                eventHash,
                status: 'PENDING',
                payload
            });
            logger.debug(`WEBHOOK | REGISTERED | ${gateway} | ID: ${gatewayEventId}`);
        }

        return false;
    } catch (error) {
        logger.error(`WEBHOOK | DB_ERROR | ID: ${gatewayEventId} | Error:`, error);
        return true;
    }
};

export const markWebhookProcessed = async (gateway: string, gatewayEventId: string) => {
    await WebhookEvent.findOneAndUpdate(
        { gateway, gatewayEventId },
        { status: 'PROCESSED', processedAt: new Date() }
    );
};

export const validatePaystackSignature = (payload: any, signature: string, secret: string): boolean => {
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(payload)).digest('hex');
    return hash === signature;
};
