import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Promotion from '../../models/Promotion';
import ReferralCampaign from '../../models/ReferralCampaign';
import User, { UserRole } from '../../models/User';
import * as storageService from '../../services/storage.service';
import * as notificationService from '../../services/notification.service';
import { logger } from '../../utils/logger';

// --- PROMOTIONS ---

export const createPromotion = async (req: AuthRequest, res: Response) => {
    try {
        const { title, description, imageUrl, ctaText, deepLink, startDate, endDate, priority, targetRole, countryCode } = req.body;

        const promotion = new Promotion({
            title,
            description,
            imageUrl,
            ctaText,
            deepLink,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            priority,
            targetRole,
            countryCode
        });

        await promotion.save();
        res.status(201).json({ success: true, data: promotion });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const listPromotions = async (req: AuthRequest, res: Response) => {
    try {
        const promotions = await Promotion.find().sort({ priority: -1, createdAt: -1 });

        // Signed URLs for images
        const data = await Promise.all(promotions.map(async (p) => {
            const obj = p.toObject();
            if (obj.imageUrl) obj.imageUrl = await storageService.getSignedUrl(obj.imageUrl);
            return obj;
        }));

        res.status(200).json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updatePromotion = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const update = req.body;

        if (update.startDate) update.startDate = new Date(update.startDate);
        if (update.endDate) update.endDate = new Date(update.endDate);

        const promotion = await Promotion.findByIdAndUpdate(id, update, { new: true });
        res.status(200).json({ success: true, data: promotion });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deletePromotion = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const promo = await Promotion.findById(id);
        if (promo?.imageUrl) await storageService.deleteFile(promo.imageUrl);
        await Promotion.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Promotion deleted' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- CUSTOM PUSH NOTIFICATIONS ---

export const listReferralCampaigns = async (req: AuthRequest, res: Response) => {
    try {
        const campaigns = await ReferralCampaign.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: campaigns });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createReferralCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const campaign = new ReferralCampaign(req.body);
        await campaign.save();
        res.status(201).json({ success: true, data: campaign });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateReferralCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const campaign = await ReferralCampaign.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json({ success: true, data: campaign });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteReferralCampaign = async (req: AuthRequest, res: Response) => {
    try {
        await ReferralCampaign.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Campaign deleted' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const sendCustomPush = async (req: AuthRequest, res: Response) => {
    try {
        const { target, title, body, imageUrl, deepLink, countryCode, province, city, serviceType, userId } = req.body;

        logger.info(`ADMIN | SEND_CUSTOM_PUSH | Target: ${target} | Title: ${title}`);

        const query: any = {};
        if (target === 'CUSTOMERS') query.role = UserRole.CUSTOMER;
        else if (target === 'PROVIDERS') query.role = UserRole.PROVIDER;

        if (countryCode) query.countryCode = countryCode;
        if (province) query.province = province;
        if (city) query.city = city;
        if (userId) query._id = userId;

        // Note: Filters by serviceType or location-radius would require more complex queries
        // for now we stick to user-model fields.

        const users = await User.find(query).select('fcmToken role');
        const tokens = users.map(u => u.fcmToken).filter(t => !!t) as string[];

        if (tokens.length === 0) {
            return res.status(404).json({ success: false, message: 'No users found with valid push tokens for this target.' });
        }

        const payload = {
            type: 'MARKETING_PUSH',
            deepLink: deepLink || '',
            imageUrl: imageUrl || ''
        };

        // Batch sending in chunks of 500 (FCM limit)
        const chunks = [];
        for (let i = 0; i < tokens.length; i += 500) {
            chunks.push(tokens.slice(i, i + 500));
        }

        for (const chunk of chunks) {
            await notificationService.notifyDevices(chunk, title, body, payload);
        }

        res.status(200).json({ success: true, message: `Notification sent to ${tokens.length} devices.` });
    } catch (error: any) {
        logger.error(`ADMIN | SEND_CUSTOM_PUSH_FAILED | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};
