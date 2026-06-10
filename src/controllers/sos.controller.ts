import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import PanicAlert from '../models/PanicAlert';
import Provider from '../models/Provider';
import { emitToUser } from '../socket/socket.service';

export const triggerSos = async (req: AuthRequest, res: Response) => {
  try {
    const { coordinates, jobId } = req.body;

    const alert = new PanicAlert({
      userId: req.user?.userId,
      jobId,
      location: {
        type: 'Point',
        coordinates
      }
    });

    await alert.save();

    // 1. Find 5 closest providers
    const closestProviders = await Provider.find({
      isOnline: true,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates },
          $maxDistance: 5000 // 5km
        }
      }
    }).limit(5);

    // 2. Notify providers (Placeholder for FCM/Socket)
    closestProviders.forEach(p => {
      emitToUser(p.userId.toString(), 'SOS_ALERT', { alertId: alert.id, coordinates });
    });

    // 3. Trigger Dashboard Alarm (Placeholder)
    console.log(`CRITICAL SOS ALERT: User ${req.user?.userId} triggered panic button!`);

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
