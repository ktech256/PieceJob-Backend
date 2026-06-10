import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Provider, { VerificationStatus } from '../models/Provider';

export const getProviderProfile = async (req: AuthRequest, res: Response) => {
  try {
    const provider = await Provider.findOne({ userId: req.user?.userId }).populate('userId', '-passwordHash');
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }
    res.status(200).json({ success: true, provider });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch provider profile', error });
  }
};

export const updateStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { isOnline } = req.body;
    const provider = await Provider.findOneAndUpdate(
      { userId: req.user?.userId },
      { isOnline, lastHeartbeat: new Date() },
      { new: true }
    );
    res.status(200).json({ success: true, isOnline: provider?.isOnline });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Status update failed', error });
  }
};

export const uploadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { type, url } = req.body; // In real app, this would be a file upload
    const provider = await Provider.findOneAndUpdate(
      { userId: req.user?.userId },
      { $push: { documents: { type, url, status: VerificationStatus.PENDING } } },
      { new: true }
    );
    res.status(200).json({ success: true, message: 'Document uploaded', provider });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Document upload failed', error });
  }
};
