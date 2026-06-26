import WebhookEvent from '../models/WebhookEvent';
import crypto from 'crypto';

export const isDuplicateWebhook = async (gateway: string, gatewayEventId: string, payload: any): Promise<boolean> => {
    if (!gatewayEventId || gatewayEventId === 'undefined') {
        console.warn(`[WEBHOOK_WARN] Invalid Event ID '${gatewayEventId}' provided for ${gateway}. Skipping idempotency check.`);
        return false;
    }

    const eventHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    try {
        const existingEvent = await WebhookEvent.findOne({ gateway, gatewayEventId });
        if (existingEvent && existingEvent.status === 'PROCESSED') {
            console.log(`[WEBHOOK_DUPLICATE] Event ${gatewayEventId} from ${gateway} already processed.`);
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
            console.log(`[WEBHOOK_PENDING] Registered new event ${gatewayEventId} from ${gateway}.`);
        }

        return false;
    } catch (error) {
        console.error(`[WEBHOOK_DB_ERROR] Idempotency check failed for ${gatewayEventId}:`, error);
        // If unique index violation occurs during concurrent requests
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
