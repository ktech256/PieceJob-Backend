import Integration from '../models/Integration';
import PaymentProvider from '../models/PaymentProvider';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

export const runFullEcosystemCheck = async () => {
    logger.debug('[HEALTH] Starting ecosystem-wide health check...');
    const integrations = await Integration.find({ isActive: true });

    for (const int of integrations) {
        try {
            let success = false;
            switch (int.type) {
                case 'GOOGLE_MAPS':
                    success = await checkGoogleHealth(int.config.get('MAPS_API_KEY') || '');
                    break;
                case 'FIREBASE':
                    // Just check if config exists for now, Firebase SDK handles its own connection
                    success = !!int.config.get('PROJECT_ID');
                    break;
                case 'EMAIL':
                    success = await checkSmtpHealth(int.config);
                    break;
                default:
                    success = true; // Auto-pass for others for now
            }

            if (success) {
                int.health.status = 'ONLINE';
                int.health.lastSuccess = new Date();
                int.health.lastError = undefined;
            } else {
                int.health.status = 'OFFLINE';
                int.health.lastFailure = new Date();
                int.health.lastError = 'Health check failed validation';
            }
        } catch (error: any) {
            int.health.status = 'OFFLINE';
            int.health.lastFailure = new Date();
            int.health.lastError = error.message;
        }
        await int.save();
    }

    logger.debug('[HEALTH] Ecosystem check completed.');
};

const checkGoogleHealth = async (key: string): Promise<boolean> => {
    if (!key) return false;
    try {
        // Simple Directions API call to check key validity
        const res = await axios.get(`https://maps.googleapis.com/maps/api/directions/json?origin=Sandton&destination=Johannesburg&key=${key}`);
        return res.data.status !== 'REQUEST_DENIED';
    } catch {
        return false;
    }
};

const checkSmtpHealth = async (config: Map<string, string>): Promise<boolean> => {
    try {
        const transporter = nodemailer.createTransport({
            host: config.get('SMTP_HOST'),
            port: parseInt(config.get('SMTP_PORT') || '587'),
            secure: config.get('SMTP_SECURE') === 'true',
            auth: {
                user: config.get('SMTP_USER'),
                pass: config.get('SMTP_PASS'),
            },
        });
        await transporter.verify();
        return true;
    } catch {
        return false;
    }
};
