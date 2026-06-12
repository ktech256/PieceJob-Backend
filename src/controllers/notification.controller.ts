import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Notification from '../models/Notification';

export const getMyNotifications = async (req: AuthRequest, res: Response) => {
    try {
        const notifications = await Notification.find({ userId: req.user?.userId })
            .sort({ createdAt: -1 })
            .limit(50);

        res.status(200).json({ success: true, notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications', error });
    }
};

export const markAsRead = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        await Notification.findOneAndUpdate(
            { _id: id, userId: req.user?.userId },
            { status: 'READ' }
        );
        res.status(200).json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update notification', error });
    }
};

// Admin Routes
export const getDeliveryLogs = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode } = req.query;
        // In a real multi-tenant scenario, we'd populate and filter by user.countryCode
        // For now, return all or filter if possible
        const logs = await Notification.find()
            .populate('userId', 'firstName lastName countryCode')
            .sort({ createdAt: -1 })
            .limit(100);

        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch logs', error });
    }
};
