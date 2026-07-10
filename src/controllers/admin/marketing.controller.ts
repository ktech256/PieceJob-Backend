import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Promotion from '../../models/Promotion';
import ReferralCampaign from '../../models/ReferralCampaign';
import User, { UserRole } from '../../models/User';
import * as storageService from '../../services/storage.service';
import * as notificationService from '../../services/notification.service';
import * as referralService from '../../services/referral.service';
import * as socketService from '../../socket/socket.service';
import { logger } from '../../utils/logger';

// --- PROMOTIONS ---

export const createPromotion = async (req: AuthRequest, res: Response) => {
    try {
        const { title, description, imageUrl, ctaText, deepLink, startDate, endDate, priority, targetRole, countryCode } = req.body;

        if (!countryCode) {
            return res.status(400).json({ success: false, message: 'Country Code is required for workspace isolation.' });
        }

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

        // Real-time Update (Issue 1)
        socketService.emitToWorkspace(countryCode, 'PROMOTIONS_UPDATED', { type: 'CREATE', workspace: countryCode });

        res.status(201).json({ success: true, data: promotion });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const listPromotions = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string;
        const query: any = {};

        // Workspace isolation: Only show global or country-specific promos
        if (countryCode && countryCode !== 'GLOBAL') {
            query.$or = [{ countryCode }, { countryCode: 'GLOBAL' }];
        }

        const promotions = await Promotion.find(query).sort({ priority: -1, createdAt: -1 });

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

        if (promotion) {
            socketService.emitToWorkspace(promotion.countryCode || 'GLOBAL', 'PROMOTIONS_UPDATED', { type: 'UPDATE', workspace: promotion.countryCode });
        }

        res.status(200).json({ success: true, data: promotion });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deletePromotion = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const promo = await Promotion.findById(id);
        if (!promo) {
            return res.status(404).json({ success: false, message: 'Promotion not found' });
        }

        if (promo.imageUrl) {
            try {
                await storageService.deleteFile(promo.imageUrl);
            } catch (storageErr) {
                logger.warn(`Failed to delete promotion image from storage: ${promo.imageUrl}`);
            }
        }

        const workspace = promo.countryCode || 'GLOBAL';
        await Promotion.findByIdAndDelete(id);

        socketService.emitToWorkspace(workspace, 'PROMOTIONS_UPDATED', { type: 'DELETE', workspace });

        res.status(200).json({ success: true, message: 'Promotion deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- REFERRAL CAMPAIGNS ---

export const listReferralCampaigns = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') {
            query.countryCode = countryCode;
        }

        const campaigns = await ReferralCampaign.find(query).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: campaigns });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createReferralCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const data = req.body;
        if (!data.countryCode) {
            return res.status(400).json({ success: false, message: 'Country Code required for referral campaign isolation.' });
        }

        const campaign = new ReferralCampaign(data);
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

export const getReferralAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode } = req.query;
        if (!countryCode) return res.status(400).json({ success: false, message: 'Country code required' });

        const analytics = await referralService.getReferralAnalytics(countryCode as string);
        res.status(200).json({ success: true, data: analytics });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const toggleReferralPrivileges = async (req: AuthRequest, res: Response) => {
    try {
        const { userId, isDisabled } = req.body;
        const adminId = req.user?.userId || 'SYSTEM';

        const user = await referralService.toggleUserReferralPrivileges(userId, isDisabled, adminId);
        res.status(200).json({ success: true, data: user });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- CUSTOM PUSH NOTIFICATIONS ---

export const sendCustomPush = async (req: AuthRequest, res: Response) => {
    try {
        const { target, title, body, imageUrl, deepLink, countryCode, province, city, userId } = req.body;

        if (!countryCode || countryCode === 'GLOBAL') {
            return res.status(400).json({ success: false, message: 'Explicit country code target is required to prevent cross-workspace dispatch leakage.' });
        }

        logger.info(`ADMIN | SEND_CUSTOM_PUSH | Target: ${target} | Workspace: ${countryCode} | Title: ${title}`);

        const query: any = { countryCode };

        if (target === 'CUSTOMERS') query.role = UserRole.CUSTOMER;
        else if (target === 'PROVIDERS') query.role = UserRole.PROVIDER;

        if (province) query.province = province;
        if (city) query.city = city;
        if (userId) query._id = userId;

        const users = await User.find(query).select('fcmToken role');
        const tokens = users.map(u => u.fcmToken).filter(t => !!t) as string[];

        if (tokens.length === 0) {
            return res.status(404).json({ success: false, message: `No users found in workspace '${countryCode}' with valid push tokens.` });
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

        res.status(200).json({ success: true, message: `Notification sent to ${tokens.length} devices in workspace ${countryCode}.` });
    } catch (error: any) {
        logger.error(`ADMIN | SEND_CUSTOM_PUSH_FAILED | Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};
