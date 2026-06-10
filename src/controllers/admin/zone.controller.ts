import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Zone from '../../models/Zone';

export const listZones = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.query.countryCode as string || req.user?.countryCode;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    const zones = await Zone.find(query);
    res.status(200).json({ success: true, zones });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch zones', error });
  }
};

export const createZone = async (req: AuthRequest, res: Response) => {
  try {
    const zone = new Zone({
        ...req.body,
        countryCode: req.user?.countryCode
    });
    await zone.save();
    res.status(201).json({ success: true, zone });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create zone', error });
  }
};
