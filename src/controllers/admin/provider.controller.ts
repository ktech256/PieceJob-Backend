import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Provider from '../../models/Provider';

export const getProvidersMonitor = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const providers = await Provider.find({ countryCode })
            .populate('userId', 'firstName lastName email phoneNumber')
            .sort({ isOnline: -1, updatedAt: -1 });

        res.status(200).json({ success: true, providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch monitor data', error });
    }
};

export const getProvidersPerformance = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const providers = await Provider.find({ countryCode })
            .select('userId tier rating acceptanceRate completionRate')
            .populate('userId', 'firstName lastName')
            .sort({ rating: -1 });

        res.status(200).json({ success: true, providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch performance data', error });
    }
};
