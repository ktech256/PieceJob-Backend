import { Request, Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as settingsService from '../../services/settings.service';
import * as auditService from '../../services/audit.service';

export const fetchSettings = async (req: AuthRequest, res: Response) => {
  try {
    // Priority: Header-injected countryCode (from tenantContext) > GLOBAL
    const countryCode = req.user?.countryCode || 'GLOBAL';
    const settings = await settingsService.getSettings(countryCode);
    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch settings', error });
  }
};

export const saveSettings = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode || 'GLOBAL';
    const oldSettings = await settingsService.getSettings(countryCode);
    const settings = await settingsService.updateSettings(countryCode, req.body);

    if (settings) {
        await auditService.logAdminAction({
            countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'SETTINGS_UPDATE',
            entityType: 'SystemSettings',
            entityId: countryCode,
            beforeState: oldSettings.toObject(),
            afterState: settings.toObject(),
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });
    }

    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to save settings', error });
  }
};
