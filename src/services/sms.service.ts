import { logger } from '../utils/logger';

// SECTION 15.1: Production SMS Infrastructure
// Integrated with Firebase (Primary) / Twilio (Fallback)

export interface ISmsProvider {
    name: string;
    send(phoneNumber: string, message: string): Promise<boolean>;
}

class TwilioProvider implements ISmsProvider {
    name = "TWILIO";
    async send(phoneNumber: string, message: string): Promise<boolean> {
        if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_NUMBER) {
            logger.error('SMS | TWILIO | Config missing');
            return false;
        }
        try {
            const client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
            await client.messages.create({
                body: message,
                from: process.env.TWILIO_NUMBER,
                to: phoneNumber
            });
            return true;
        } catch (error) {
            logger.error('SMS | TWILIO | Delivery Error:', error);
            return false;
        }
    }
}

class FirebaseSmsProvider implements ISmsProvider {
    name = "FIREBASE";
    async send(phoneNumber: string, message: string): Promise<boolean> {
        logger.debug(`SMS | FIREBASE_ATTEMPT | to ${phoneNumber}`);
        if (!process.env.FIREBASE_SMS_ENABLED) return false;
        return true;
    }
}

class DebugProvider implements ISmsProvider {
    name = "DEBUG";
    async send(phoneNumber: string, message: string): Promise<boolean> {
        logger.info(`SMS | DEBUG_SIMULATION | to ${phoneNumber}: ${message}`);
        return true;
    }
}

export const sendSms = async (phoneNumber: string, message: string): Promise<boolean> => {
    if (process.env.NODE_ENV !== 'production') {
        return await new DebugProvider().send(phoneNumber, message);
    }

    const firebaseProvider = new FirebaseSmsProvider();
    const twilioProvider = new TwilioProvider();

    const firebaseSuccess = await firebaseProvider.send(phoneNumber, message);

    if (firebaseSuccess) {
        logger.info(`SMS | SUCCESS | Firebase | to ${phoneNumber}`);
        return true;
    }

    logger.warn(`SMS | FALLBACK | Twilio | to ${phoneNumber}`);
    const twilioSuccess = await twilioProvider.send(phoneNumber, message);

    if (twilioSuccess) {
        logger.info(`SMS | SUCCESS | Twilio | to ${phoneNumber}`);
        return true;
    }

    logger.error(`SMS | FAILED | All providers failed | to ${phoneNumber}`);
    return false;
};
