import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import PanicAlert from '../models/PanicAlert';
import Provider from '../models/Provider';
import { emitToUser } from '../socket/socket.service';

import * as settingsService from '../services/settings.service';

import User from '../models/User';

export const getActiveAlerts = async (req: AuthRequest, res: Response) => {
    try {
        const alerts = await PanicAlert.find({ status: 'ACTIVE' })
            .populate('userId', 'firstName lastName phoneNumber email')
            .populate('jobId')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, alerts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch alerts', error });
    }
};

import * as notificationQueue from '../services/notification.queue';

export const triggerSos = async (req: AuthRequest, res: Response) => {
  try {
    const { coordinates, jobId } = req.body;
    const settings = await settingsService.getSettings(req.user?.countryCode);

    const alert = new PanicAlert({
      userId: req.user?.userId,
      jobId,
      location: {
        type: 'Point',
        coordinates
      }
    });

    await alert.save();

    // 1. Find closest providers based on dynamic settings
    const closestProviders = await Provider.find({
      isOnline: true,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates },
          $maxDistance: settings.sosAlertRadiusKm * 1000
        }
      }
    }).limit(10);

    // 2. Fetch FCM tokens for notification targets
    const providerUserIds = closestProviders.map(p => p.userId);
    const usersWithTokens = await User.find({
        _id: { $in: providerUserIds },
        fcmToken: { $exists: true, $ne: null }
    }).select('fcmToken');

    const tokens = usersWithTokens.map(u => u.fcmToken!);

    // 3. Notify providers (FCM + Socket)
    closestProviders.forEach(p => {
      emitToUser(p.userId.toString(), 'SOS_ALERT', { alertId: alert.id, coordinates });
    });

    if (tokens.length > 0) {
        // Queue Push Notifications for all relevant tokens using template
        for (const token of tokens) {
            await notificationQueue.addNotificationToQueue({
                type: 'PUSH',
                fcmToken: token,
                templateCode: 'SOS_ALERT',
                templateData: {
                    alertId: alert.id.toString(),
                    coordinates: coordinates.join(',')
                },
                data: { alertId: alert.id, coordinates: JSON.stringify(coordinates) },
                countryCode: req.user?.countryCode
            });
        }
    }

    res.status(201).json({ success: true, alertId: alert.id });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to trigger SOS', error });
  }
};

export const resolveSos = async (req: AuthRequest, res: Response) => {
  try {
    const { alertId } = req.params;
    const { status } = req.body; // RESOLVED or FALSE_ALARM

    await PanicAlert.findByIdAndUpdate(alertId, {
      status,
      resolvedBy: req.user?.userId
    });

    res.status(200).json({ success: true, message: 'SOS resolved' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Resolution failed', error });
  }
};
