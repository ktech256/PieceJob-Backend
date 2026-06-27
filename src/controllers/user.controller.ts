import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User';
import * as auditService from '../services/audit.service';
import * as storageService from '../services/storage.service';

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user?.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userData = user.toObject();
    if (userData.profilePhoto) {
        userData.profilePhoto = await storageService.getSignedUrl(userData.profilePhoto);
    }
    if (userData.pendingAddress?.proofOfResidenceUrl) {
        userData.pendingAddress.proofOfResidenceUrl = await storageService.getSignedUrl(userData.pendingAddress.proofOfResidenceUrl);
    }

    res.status(200).json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile', error });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, email } = req.body;
    const oldUser = await User.findById(req.user?.userId);
    const user = await User.findByIdAndUpdate(
      req.user?.userId,
      { firstName, lastName, email },
      { new: true }
    ).select('-passwordHash');

    if (user && oldUser) {
        await auditService.logUserModification({
            countryCode: user.countryCode,
            userId: user.id,
            action: 'PROFILE_UPDATE',
            modificationType: 'Personal Info',
            beforeState: { firstName: oldUser.firstName, lastName: oldUser.lastName, email: oldUser.email },
            afterState: { firstName: user.firstName, lastName: user.lastName, email: user.email },
            triggeredBy: 'USER',
            ipAddress: req.ip,
            systemSource: 'API'
        });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed', error });
  }
};

export const updateFcmToken = async (req: AuthRequest, res: Response) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user?.userId;

    console.log(`[FCM_BACKEND_RECEIVED] User: ${userId}, Token: ${fcmToken?.substring(0, 10)}...`);

    if (!fcmToken) {
        console.warn(`[FCM_TOKEN_AUDIT] WARN: Received NULL/EMPTY token for User ${userId}. Ignoring.`);
        return res.status(200).json({ success: true, message: 'Empty token ignored' });
    }

    console.log(`[FCM_DB_VERIFY] Attempting MongoDB update for User ${userId}`);
    const result = await User.updateOne({ _id: userId }, { fcmToken });
    console.log(`[FCM_DB_VERIFY] Update Result: Matched=${result.matchedCount}, Modified=${result.modifiedCount}`);

    // Read again to confirm save
    const updatedUser = await User.findById(userId);
    if (updatedUser?.fcmToken === fcmToken) {
        console.log(`[FCM_DB_VERIFY] SUCCESS: Token verified in MongoDB. Len=${updatedUser.fcmToken?.length || 0}`);
    } else {
        console.error(`[FCM_DB_VERIFY] ERROR: Mismatch! Found ${updatedUser?.fcmToken ? 'DIFFERENT' : 'NULL'} token in DB.`);
    }

    res.status(200).json({ success: true, message: 'FCM token updated' });
  } catch (error: any) {
    console.error(`[FCM_TOKEN_AUDIT] FATAL ERROR for User ${req.user?.userId}:`, error.message);
    res.status(500).json({ success: false, message: 'Failed to update FCM token', error });
  }
};

export const getReferralStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const user = await User.findById(userId);

        const referrals = await User.find({ referredBy: userId }).select('firstName lastName createdAt isVerified');

        res.status(200).json({
            success: true,
            data: {
                referralCode: user?.referralCode,
                totalReferrals: referrals.length,
                pendingRewards: 0, // Logic for pending
                paidRewards: 0, // Logic for paid
                history: referrals
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch referral stats', error });
    }
};
