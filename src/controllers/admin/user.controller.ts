import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User from '../../models/User';
import * as notificationQueue from '../../services/notification.queue';
import * as auditService from '../../services/audit.service';

export const listUsers = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const { isTestUser } = req.query;

    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    if (isTestUser !== undefined) {
      query.isTestUser = isTestUser === 'true';
    }

    const users = await User.find(query).select('-passwordHash').sort({ createdAt: -1 });
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch users', error });
  }
};

export const getUserById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('-passwordHash');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch user', error });
  }
};

export const updateUserStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { isBanned, reason } = req.body;

        const oldUser = await User.findById(id);
        if (!oldUser) return res.status(404).json({ success: false, message: 'User not found' });

        const user = await User.findByIdAndUpdate(id, { isBanned }, { new: true });

        // Audit Log
        await auditService.logAdminAction({
            countryCode: user?.countryCode || 'GLOBAL',
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: isBanned ? 'USER_BANNED' : 'USER_UNBANNED',
            entityType: 'User',
            entityId: id,
            afterState: { isBanned, reason },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        // Dispatch Email
        if (user?.email) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email: user.email,
                templateCode: isBanned ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED',
                templateData: {
                    firstName: user.firstName,
                    reason: reason || 'Violation of platform terms.'
                },
                countryCode: user.countryCode
            });
        }

        res.status(200).json({ success: true, user });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
