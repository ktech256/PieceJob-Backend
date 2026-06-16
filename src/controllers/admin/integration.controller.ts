import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Integration from '../../models/Integration';

export const listIntegrations = async (req: AuthRequest, res: Response) => {
    try {
        const integrations = await Integration.find();
        res.status(200).json({ success: true, data: integrations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch integrations', error });
    }
};

export const updateIntegration = async (req: AuthRequest, res: Response) => {
    try {
        const { type } = req.params;
        const { config, isActive } = req.body;

        const integration = await Integration.findOneAndUpdate(
            { type },
            { config, isActive, updatedBy: req.user?.userId },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, data: integration });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update integration', error });
    }
};

export const getPublicConfig = async (req: AuthRequest, res: Response) => {
    try {
        // Only return non-sensitive public keys if needed by Android
        const maps = await Integration.findOne({ type: 'GOOGLE_MAPS' });

        res.status(200).json({
            success: true,
            data: {
                googleMaps: maps?.isActive ? {
                    apiKey: maps.config.get('MAPS_API_KEY'),
                    placesKey: maps.config.get('PLACES_API_KEY')
                } : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch public config' });
    }
};
