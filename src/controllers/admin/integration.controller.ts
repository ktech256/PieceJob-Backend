import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Integration from '../../models/Integration';
import { logAdminAction } from '../../services/audit.service';

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

        const old = await Integration.findOne({ type });

        const integration = await Integration.findOneAndUpdate(
            { type },
            {
                config,
                isActive,
                updatedBy: req.user?.userId,
                // If config changed, store the old one as backup
                ...(old && { backupConfig: old.config, lastRotationDate: new Date() })
            },
            { new: true, upsert: true }
        );

        // Log the action
        await logAdminAction({
            countryCode: 'GLOBAL',
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'UPDATE_INTEGRATION',
            entityType: 'Integration',
            entityId: type,
            beforeState: old?.config,
            afterState: config,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, data: integration });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update integration', error });
    }
};

export const rotateKey = async (req: AuthRequest, res: Response) => {
    try {
        const { type } = req.params;
        const integration = await Integration.findOne({ type });
        if (!integration) return res.status(404).json({ success: false, message: 'Integration not found' });

        // Move backup to active
        const beforeState = { config: integration.config, backup: integration.backupConfig };
        const temp = integration.config;
        integration.config = integration.backupConfig;
        integration.backupConfig = temp;
        integration.lastRotationDate = new Date();
        integration.updatedBy = req.user?.userId as any;

        await integration.save();

        // Log the action
        await logAdminAction({
            countryCode: 'GLOBAL',
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'ROTATE_INTEGRATION_KEYS',
            entityType: 'Integration',
            entityId: type,
            beforeState: beforeState,
            afterState: { config: integration.config, backup: integration.backupConfig },
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, data: integration });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Rotation failed' });
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
                    apiKey: maps.config?.android?.mapsApiKey || maps.config?.MAPS_API_KEY,
                    placesKey: maps.config?.android?.placesApiKey || maps.config?.PLACES_API_KEY
                } : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch public config' });
    }
};
