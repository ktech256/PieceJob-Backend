import { Request, Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as settingsService from '../../services/settings.service';

export const fetchSettings = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = (req.query.countryCode as string) || 'GLOBAL';
    const settings = await settingsService.getSettings(countryCode);
    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch settings', error });
  }
};

export const saveSettings = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.body.countryCode || 'GLOBAL';
    const settings = await settingsService.updateSettings(countryCode, req.body);
    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to save settings', error });
  }
};
