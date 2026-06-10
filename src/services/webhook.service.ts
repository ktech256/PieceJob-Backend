import WebhookEvent from '../models/WebhookEvent';
import crypto from 'crypto';

export const isDuplicateWebhook = async (gateway: string, gatewayEventId: string, payload: any): Promise<boolean> => {
    const eventHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    try {
        const existingEvent = await WebhookEvent.findOne({ gateway, gatewayEventId });
        if (existingEvent && existingEvent.status === 'PROCESSED') {
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
        }

        return false;
    } catch (error) {
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
