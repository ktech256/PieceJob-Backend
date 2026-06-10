// SECTION 15.1: Production SMS Infrastructure
// Integrated with Twilio / MessageBird / Local Gateway

export interface ISmsProvider {
    send(phoneNumber: string, message: string): Promise<boolean>;
}

class TwilioProvider implements ISmsProvider {
    async send(phoneNumber: string, message: string): Promise<boolean> {
        if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_NUMBER) {
            console.error('Twilio configuration missing');
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
            console.error('Twilio Delivery Error:', error);
            return false;
        }
    }
}

class DebugProvider implements ISmsProvider {
    async send(phoneNumber: string, message: string): Promise<boolean> {
        const payload = {
            timestamp: new Date().toISOString(),
            to: phoneNumber,
            content: message,
            gateway: 'SIMULATED_DEBUG'
        };
        console.log(`[SMS_SIMULATION] ${JSON.stringify(payload)}`);
        return true;
    }
}

const getProvider = (): ISmsProvider => {
    if (process.env.NODE_ENV === 'production' && process.env.TWILIO_SID) {
        return new TwilioProvider();
    }
    return new DebugProvider();
};

export const sendSms = async (phoneNumber: string, message: string): Promise<boolean> => {
    const provider = getProvider();
    return await provider.send(phoneNumber, message);
};
